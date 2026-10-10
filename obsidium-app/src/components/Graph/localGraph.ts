import { forEachNeighbour, type Adjacency } from './adjacency';

export function localGraphMask(
  adjacency: Adjacency,
  center: number,
  depth: number,
  allowed?: Uint8Array | null,
): Uint8Array | null {
  const nodeCount = adjacency.offsets.length - 1;
  if (!Number.isInteger(center) || center < 0 || center >= nodeCount) return null;
  if (!Number.isInteger(depth) || depth < 1 || depth > 4) return null;
  const included = new Uint8Array(nodeCount);
  const distances = new Uint8Array(nodeCount);
  const queue = new Uint32Array(nodeCount);
  included[center] = 1;
  queue[0] = center;
  let head = 0;
  let tail = 1;
  while (head < tail) {
    const node = queue[head];
    head += 1;
    if (distances[node] >= depth) continue;
    forEachNeighbour(adjacency, node, (neighbour) => {
      if (included[neighbour] || (allowed !== null && allowed !== undefined && allowed[neighbour] !== 1)) return true;
      included[neighbour] = 1;
      distances[neighbour] = distances[node] + 1;
      queue[tail] = neighbour;
      tail += 1;
      return true;
    });
  }
  return included;
}
