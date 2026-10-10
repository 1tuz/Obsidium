export interface CommunityRepresentative {
  id: number;
  count: number;
  node: number;
}

export interface CommunityLabel extends CommunityRepresentative {
  stableId: string;
  name: string;
}

export interface CommunityIndex {
  counts: Uint32Array;
  representatives: Uint32Array;
  rankedIds: Uint32Array;
  communityByRepresentativeId: ReadonlyMap<string, number>;
  total: number;
}

export const COMMUNITY_PAGE_SIZE = 12;

export function communityStableId(nodeIds: Uint32Array, node: number): string {
  return `${nodeIds[node * 2 + 1]}:${nodeIds[node * 2]}`;
}

export function buildCommunityIndex(
  communityIds: Uint32Array,
  degrees: Uint32Array,
  nodeIds: Uint32Array,
): CommunityIndex {
  const counts = new Uint32Array(communityIds.length);
  const representatives = new Uint32Array(communityIds.length);
  representatives.fill(0xffff_ffff);

  for (let node = 0; node < communityIds.length; node += 1) {
    const id = communityIds[node];
    if (id >= communityIds.length) continue;
    counts[id] += 1;
    const representative = representatives[id];
    if (representative === 0xffff_ffff
      || degrees[node] > degrees[representative]
      || (degrees[node] === degrees[representative] && hasLowerStableId(node, representative, nodeIds))) {
      representatives[id] = node;
    }
  }

  let total = 0;
  for (const count of counts) if (count > 0) total += 1;

  const rankedIds = new Uint32Array(total);
  for (let id = 0, rank = 0; id < counts.length; id += 1) {
    if (counts[id] > 0) rankedIds[rank++] = id;
  }
  rankedIds.sort((left, right) => compareCommunityIds(left, right, counts));
  const communityByRepresentativeId = new Map<string, number>();
  for (const id of rankedIds) {
    communityByRepresentativeId.set(communityStableId(nodeIds, representatives[id]), id);
  }
  return { counts, representatives, rankedIds, communityByRepresentativeId, total };
}

export function communityPage(
  index: CommunityIndex,
  page: number,
  pageSize = COMMUNITY_PAGE_SIZE,
): CommunityRepresentative[] {
  const offset = Math.min(Math.max(0, Math.floor(page)), Math.max(Math.ceil(index.total / pageSize) - 1, 0)) * pageSize;
  const ids = index.rankedIds.subarray(offset, offset + pageSize);
  return Array.from(ids, (id) => ({
    id,
    count: index.counts[id],
    node: index.representatives[id],
  }));
}

export function collapsedCommunityIds(
  index: CommunityIndex,
  collapsed: Record<string, boolean>,
): number[] {
  const collapsedIds: number[] = [];
  for (const stableId in collapsed) {
    if (Object.prototype.hasOwnProperty.call(collapsed, stableId) && collapsed[stableId] === true) {
      const id = index.communityByRepresentativeId.get(stableId);
      if (id !== undefined) collapsedIds.push(id);
    }
  }
  return collapsedIds.sort((left, right) => left - right);
}

export function clampCommunityPage(page: number, communityCount: number): number {
  return Math.min(Math.max(0, Math.floor(page)), Math.max(Math.ceil(communityCount / COMMUNITY_PAGE_SIZE) - 1, 0));
}

function compareCommunityIds(left: number, right: number, counts: Uint32Array): number {
  return counts[right] - counts[left] || left - right;
}

function hasLowerStableId(left: number, right: number, nodeIds: Uint32Array): boolean {
  const leftHigh = nodeIds[left * 2 + 1];
  const rightHigh = nodeIds[right * 2 + 1];
  return leftHigh < rightHigh || (leftHigh === rightHigh && nodeIds[left * 2] < nodeIds[right * 2]);
}
