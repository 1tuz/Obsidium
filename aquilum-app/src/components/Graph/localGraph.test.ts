import { describe, expect, it } from 'vitest';
import { localGraphMask } from './localGraph';
import type { Adjacency } from './adjacency';

const adjacency: Adjacency = {
  offsets: new Uint32Array([0, 1, 3, 4, 4, 5, 6]),
  targets: new Uint32Array([1, 0, 2, 1, 5, 4]),
  islandNodes: new Uint8Array(6),
};

describe('localGraphMask', () => {
  it('includes the center and nodes up to the requested depth', () => {
    expect([...localGraphMask(adjacency, 0, 2)!]).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it('does not traverse through nodes hidden by metadata filters', () => {
    expect([...localGraphMask(adjacency, 0, 4, new Uint8Array([1, 0, 1, 1, 1, 1]))!])
      .toEqual([1, 0, 0, 0, 0, 0]);
  });

  it('returns null when there is no valid center or depth', () => {
    expect(localGraphMask(adjacency, -1, 1)).toBeNull();
    expect(localGraphMask(adjacency, 0, 5)).toBeNull();
  });

  it.each([100, 1_000, 10_000, 100_000])('keeps a depth-four view bounded in a %i-node graph', (nodeCount) => {
    const offsets = new Uint32Array(nodeCount + 1);
    const targets = new Uint32Array((nodeCount - 1) * 2);
    for (let node = 0; node < nodeCount; node += 1) {
      offsets[node] = node === 0 ? 0 : node * 2 - 1;
      const start = offsets[node];
      if (node > 0) targets[start] = node - 1;
      if (node < nodeCount - 1) targets[start + Number(node > 0)] = node + 1;
    }
    offsets[nodeCount] = targets.length;
    const mask = localGraphMask({ offsets, targets, islandNodes: new Uint8Array(nodeCount) }, Math.floor(nodeCount / 2), 4)!;
    expect(mask.reduce((sum, included) => sum + included, 0)).toBe(9);
  });
});
