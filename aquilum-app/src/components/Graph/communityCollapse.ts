import type { GraphSnapshot } from '../../modules/graph';

export interface CommunityProjection {
  nodeRepresentatives: Uint32Array;
  visibleNodes: Uint8Array;
}

export interface CommunityEdges {
  edges: Uint32Array;
  directions: Uint32Array;
  types: Uint32Array;
}

export function communityProjection(
  snapshot: GraphSnapshot,
  collapsedCommunities: number[],
  eligibleNodes?: Uint8Array | null,
): CommunityProjection {
  const collapsed = new Set(collapsedCommunities);
  const representativesByCommunity = new Uint32Array(snapshot.nodeCount);
  representativesByCommunity.fill(0xffff_ffff);
  for (let node = 0; node < snapshot.nodeCount; node += 1) {
    const community = snapshot.clusterIds[node];
    if (!collapsed.has(community) || community >= snapshot.nodeCount) continue;
    if (eligibleNodes && eligibleNodes[node] !== 1) continue;
    const representative = representativesByCommunity[community];
    if (representative === 0xffff_ffff
      || snapshot.degrees[node] > snapshot.degrees[representative]
      || (snapshot.degrees[node] === snapshot.degrees[representative]
        && hasLowerStableId(node, representative, snapshot.nodeIds))) {
      representativesByCommunity[community] = node;
    }
  }
  const nodeRepresentatives = new Uint32Array(snapshot.nodeCount);
  const visibleNodes = new Uint8Array(snapshot.nodeCount);
  for (let node = 0; node < snapshot.nodeCount; node += 1) {
    const community = snapshot.clusterIds[node];
    const representative = community < snapshot.nodeCount
      ? representativesByCommunity[community]
      : 0xffff_ffff;
    nodeRepresentatives[node] = representative === 0xffff_ffff ? node : representative;
    visibleNodes[node] = nodeRepresentatives[node] === node ? 1 : 0;
  }
  return { nodeRepresentatives, visibleNodes };
}

export function projectCommunityEdges(
  edges: Uint32Array,
  directions: Uint32Array,
  types: Uint32Array,
  nodeRepresentatives: Uint32Array,
  allowedNodes?: Uint8Array | null,
): CommunityEdges {
  let collapsed = false;
  for (let node = 0; node < nodeRepresentatives.length; node += 1) {
    if (nodeRepresentatives[node] !== node) {
      collapsed = true;
      break;
    }
  }
  if (!collapsed) return { edges, directions, types };
  const projected = new Map<number, [number, number, number, number]>();
  const nodeCount = nodeRepresentatives.length;
  for (let edge = 0; edge < directions.length; edge += 1) {
    const sourceLeft = edges[edge * 2];
    const sourceRight = edges[edge * 2 + 1];
    if (allowedNodes && (allowedNodes[sourceLeft] !== 1 || allowedNodes[sourceRight] !== 1)) continue;
    let left = nodeRepresentatives[sourceLeft];
    let right = nodeRepresentatives[sourceRight];
    let direction = directions[edge];
    if (left === right) continue;
    if (left > right) {
      [left, right] = [right, left];
      direction = ((direction & 1) << 1) | ((direction & 2) >> 1);
    }
    const key = left * nodeCount + right;
    const current = projected.get(key);
    if (current) {
      current[2] |= direction;
      current[3] |= types[edge];
    } else {
      projected.set(key, [left, right, direction, types[edge]]);
    }
  }
  const projectedEdges: number[] = [];
  const projectedDirections: number[] = [];
  const projectedTypes: number[] = [];
  for (const [left, right, direction, type] of projected.values()) {
    projectedEdges.push(left, right);
    projectedDirections.push(direction);
    projectedTypes.push(type);
  }
  return {
    edges: new Uint32Array(projectedEdges),
    directions: new Uint32Array(projectedDirections),
    types: new Uint32Array(projectedTypes),
  };
}

function hasLowerStableId(left: number, right: number, nodeIds: Uint32Array): boolean {
  const leftHigh = nodeIds[left * 2 + 1];
  const rightHigh = nodeIds[right * 2 + 1];
  return leftHigh < rightHigh || (leftHigh === rightHigh && nodeIds[left * 2] < nodeIds[right * 2]);
}
