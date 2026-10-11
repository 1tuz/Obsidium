import type { GraphSnapshot } from '../../modules/graph';
import type { GraphEdgeType } from './graphDisplay';

export interface Adjacency {
  offsets: Uint32Array;
  targets: Uint32Array;
  islandNodes: Uint8Array;
  edgeType?: GraphEdgeType;
  overlay?: Map<number, Map<number, { active: boolean; base: boolean }>>;
  overlaySize?: number;
}

export interface AdjacencyEdgeUpdate {
  source: number;
  target: number;
  previousTypeMask: number;
  typeMask: number;
}

const MAX_ADJACENCY_OVERLAY_EDGES = 4_096;

export function buildAdjacency(snapshot: GraphSnapshot, edgeType: GraphEdgeType = 'all'): Adjacency {
  const offsets = new Uint32Array(snapshot.nodeCount + 1);
  const edgeSlots = snapshot.edgeSlotCount ?? snapshot.edgeCount;
  for (let edge = 0; edge < edgeSlots; edge += 1) {
    const typeMask = snapshot.edgeTypes?.[edge] ?? 1;
    if (typeMask === 0 || !includesEdgeType(typeMask, edgeType)) continue;
    offsets[snapshot.edges[edge * 2] + 1] += 1;
    offsets[snapshot.edges[edge * 2 + 1] + 1] += 1;
  }
  for (let node = 0; node < snapshot.nodeCount; node += 1) {
    offsets[node + 1] += offsets[node];
  }
  const cursor = offsets.slice();
  const targets = new Uint32Array(offsets[snapshot.nodeCount]);
  for (let edge = 0; edge < edgeSlots; edge += 1) {
    const typeMask = snapshot.edgeTypes?.[edge] ?? 1;
    if (typeMask === 0 || !includesEdgeType(typeMask, edgeType)) continue;
    const left = snapshot.edges[edge * 2];
    const right = snapshot.edges[edge * 2 + 1];
    targets[cursor[left]] = right;
    cursor[left] += 1;
    targets[cursor[right]] = left;
    cursor[right] += 1;
  }
  return { offsets, targets, islandNodes: islandNodes(offsets, targets), edgeType };
}

export function applyAdjacencyEdgeUpdates(
  adjacency: Adjacency,
  updates: readonly AdjacencyEdgeUpdate[],
): boolean {
  const edgeType = adjacency.edgeType ?? 'all';
  const overlay = adjacency.overlay ?? new Map<number, Map<number, { active: boolean; base: boolean }>>();
  let overlaySize = adjacency.overlaySize ?? 0;
  for (const update of updates) {
    const wasIncluded = includesEdgeType(update.previousTypeMask, edgeType);
    const isIncluded = includesEdgeType(update.typeMask, edgeType);
    if (wasIncluded === isIncluded) continue;
    for (const [node, neighbour] of [[update.source, update.target], [update.target, update.source]]) {
      let row = overlay.get(node);
      const existing = row?.get(neighbour);
      const base = existing?.base ?? hasBaseNeighbour(adjacency, node, neighbour);
      const active = existing?.active ?? base;
      if (active === isIncluded) continue;
      if (!row) {
        row = new Map();
        overlay.set(node, row);
      }
      if (isIncluded === base) {
        row.delete(neighbour);
        overlaySize -= 1;
        if (row.size === 0) overlay.delete(node);
      } else {
        row.set(neighbour, { active: isIncluded, base });
        if (!existing) overlaySize += 1;
      }
    }
  }
  adjacency.overlay = overlay;
  adjacency.overlaySize = overlaySize;
  return overlaySize <= MAX_ADJACENCY_OVERLAY_EDGES;
}

function islandNodes(offsets: Uint32Array, targets: Uint32Array): Uint8Array {
  const nodeCount = offsets.length - 1;
  const componentIds = new Uint32Array(nodeCount);
  componentIds.fill(0xffff_ffff);
  const queue = new Uint32Array(nodeCount);
  const sizes: number[] = [];
  let largest = 0;
  let dominant = -1;
  let componentCount = 0;
  for (let start = 0; start < nodeCount; start += 1) {
    if (componentIds[start] !== 0xffff_ffff) continue;
    const component = componentCount;
    componentCount += 1;
    componentIds[start] = component;
    queue[0] = start;
    let head = 0;
    let tail = 1;
    let size = 0;
    while (head < tail) {
      const node = queue[head];
      head += 1;
      size += 1;
      for (let slot = offsets[node]; slot < offsets[node + 1]; slot += 1) {
        const neighbour = targets[slot];
        if (componentIds[neighbour] !== 0xffff_ffff) continue;
        componentIds[neighbour] = component;
        queue[tail] = neighbour;
        tail += 1;
      }
    }
    sizes[component] = size;
    if (size > largest) {
      largest = size;
      dominant = component;
    }
  }
  const islands = new Uint8Array(nodeCount);
  for (let node = 0; node < nodeCount; node += 1) {
    const component = componentIds[node];
    if (component !== dominant && sizes[component] > 1) islands[node] = 1;
  }
  return islands;
}

function includesEdgeType(mask: number, edgeType: GraphEdgeType): boolean {
  if (edgeType === 'all') return mask !== 0;
  const typeMask = {
    wiki: 1,
    markdown: 2,
    parent: 4,
    related: 8,
    depends_on: 16,
    blocks: 32,
  }[edgeType];
  return (mask & typeMask) !== 0;
}

function hasBaseNeighbour(adjacency: Adjacency, node: number, target: number): boolean {
  for (let slot = adjacency.offsets[node]; slot < adjacency.offsets[node + 1]; slot += 1) {
    if (adjacency.targets[slot] === target) return true;
  }
  return false;
}

export function neighbours(adjacency: Adjacency, node: number): Uint32Array {
  const overlay = adjacency.overlay?.get(node);
  if (!overlay || overlay.size === 0) {
    return adjacency.targets.subarray(adjacency.offsets[node], adjacency.offsets[node + 1]);
  }
  const targets: number[] = [];
  forEachNeighbour(adjacency, node, (target) => {
    targets.push(target);
  });
  return new Uint32Array(targets);
}

export function forEachNeighbour(
  adjacency: Adjacency,
  node: number,
  visit: (target: number) => boolean | void,
): void {
  const overlay = adjacency.overlay?.get(node);
  for (let slot = adjacency.offsets[node]; slot < adjacency.offsets[node + 1]; slot += 1) {
    const target = adjacency.targets[slot];
    if (overlay?.get(target)?.active === false) continue;
    if (visit(target) === false) return;
  }
  if (!overlay) return;
  for (const [target, update] of overlay) {
    if (update.active && !update.base && visit(target) === false) return;
  }
}

export function shortestPath(
  adjacency: Adjacency,
  start: number,
  end: number,
  allowed: (node: number) => boolean = () => true,
): number[] | null {
  const nodeCount = adjacency.offsets.length - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end < 0 || start >= nodeCount || end >= nodeCount
    || !allowed(start) || !allowed(end)) return null;
  if (start === end) return [start];
  const previous = new Int32Array(nodeCount);
  previous.fill(-1);
  previous[start] = start;
  const queue = new Uint32Array(nodeCount);
  let head = 0;
  let tail = 0;
  queue[tail] = start;
  tail += 1;
  while (head < tail) {
    const node = queue[head];
    head += 1;
    let found = false;
    forEachNeighbour(adjacency, node, (neighbour) => {
      if (previous[neighbour] >= 0 || !allowed(neighbour)) return true;
      previous[neighbour] = node;
      if (neighbour === end) {
        found = true;
        return false;
      }
      queue[tail] = neighbour;
      tail += 1;
      return true;
    });
    if (found) {
      const path = [end];
      for (let cursor = end; cursor !== start; cursor = previous[cursor]) path.push(previous[cursor]);
      path.reverse();
      return path;
    }
  }
  return null;
}

export function visitLevels(
  adjacency: Adjacency,
  start: number,
  depth: number,
  limit: number,
  visit: (node: number, level: number) => void,
): void {
  const seen = new Set([start]);
  let frontier = [start];
  visit(start, 0);
  for (let level = 1; level <= depth && frontier.length > 0 && seen.size < limit; level += 1) {
    const next: number[] = [];
    for (const node of frontier) {
      forEachNeighbour(adjacency, node, (neighbour) => {
        if (seen.has(neighbour)) return true;
        seen.add(neighbour);
        next.push(neighbour);
        visit(neighbour, level);
        return seen.size < limit;
      });
      if (seen.size >= limit) break;
    }
    frontier = next;
  }
}
