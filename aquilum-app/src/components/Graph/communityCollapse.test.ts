import { describe, expect, it } from 'vitest';
import { communityProjection, projectCommunityEdges } from './communityCollapse';
import type { GraphSnapshot } from '../../modules/graph';

function snapshot(clusterIds: number[], degrees: number[]): GraphSnapshot {
  const nodeCount = clusterIds.length;
  return {
    nodeCount,
    edgeCount: 0,
    epoch: { low: 1, high: 0 },
    positions: new Float32Array(nodeCount * 2),
    createdDays: new Float32Array(nodeCount),
    modifiedDays: new Float32Array(nodeCount),
    degrees: new Uint32Array(degrees),
    nodeIds: Uint32Array.from(clusterIds.flatMap((_, node) => [node + 10, 0])),
    clusterIds: new Uint32Array(clusterIds),
    edges: new Uint32Array(0),
    edgeDirections: new Uint32Array(0),
    edgeTypes: new Uint32Array(0),
  };
}

describe('communityProjection', () => {
  it('keeps the highest-degree note in collapsed communities', () => {
    const result = communityProjection(snapshot([0, 0, 1, 1, 2], [1, 5, 2, 4, 1]), [0, 1]);
    expect([...result.nodeRepresentatives]).toEqual([1, 1, 3, 3, 4]);
    expect([...result.visibleNodes]).toEqual([0, 1, 0, 1, 1]);
  });

  it('preserves stable representative choice when degrees tie', () => {
    const result = communityProjection(snapshot([0, 0, 0], [4, 4, 4]), [0]);
    expect([...result.nodeRepresentatives]).toEqual([0, 0, 0]);
  });

  it('chooses an eligible representative when the highest-degree note is filtered out', () => {
    const result = communityProjection(
      snapshot([0, 0], [9, 4]),
      [0],
      new Uint8Array([0, 1]),
    );
    expect([...result.nodeRepresentatives]).toEqual([1, 1]);
    expect([...result.visibleNodes]).toEqual([0, 1]);
  });
});

describe('projectCommunityEdges', () => {
  it('rewires inter-community edges and drops internal edges without losing type or direction', () => {
    const result = projectCommunityEdges(
      new Uint32Array([0, 2, 1, 3, 0, 1, 2, 4]),
      new Uint32Array([1, 1, 3, 2]),
      new Uint32Array([1, 4, 1, 16]),
      new Uint32Array([1, 1, 3, 3, 4]),
    );
    expect([...result.edges]).toEqual([1, 3, 3, 4]);
    expect([...result.directions]).toEqual([1, 2]);
    expect([...result.types]).toEqual([5, 16]);
  });

  it('flips direction bits when the representative order reverses an edge', () => {
    const projection = communityProjection(snapshot([0, 1, 1, 0], [1, 8, 3, 9]), [0, 1]);
    const result = projectCommunityEdges(
      new Uint32Array([0, 1]),
      new Uint32Array([1]),
      new Uint32Array([32]),
      projection.nodeRepresentatives,
    );
    expect([...result.edges]).toEqual([1, 3]);
    expect([...result.directions]).toEqual([2]);
    expect([...result.types]).toEqual([32]);
  });

  it('removes edges incident to notes excluded by active graph filters', () => {
    const result = projectCommunityEdges(
      new Uint32Array([0, 2, 1, 2]),
      new Uint32Array([1, 1]),
      new Uint32Array([1, 1]),
      new Uint32Array([0, 0, 2]),
      new Uint8Array([1, 1, 0]),
    );
    expect([...result.edges]).toEqual([]);
  });
});
