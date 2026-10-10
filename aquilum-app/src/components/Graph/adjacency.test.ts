import { describe, expect, it } from 'vitest';
import {
  applyAdjacencyEdgeUpdates,
  buildAdjacency,
  neighbours,
  shortestPath,
  visitLevels,
} from './adjacency';
import type { GraphSnapshot } from '../../modules/graph';

function snapshot(nodeCount: number, edges: number[]): GraphSnapshot {
  return {
    nodeCount,
    edgeCount: edges.length / 2,
    epoch: { low: 0, high: 0 },
    positions: new Float32Array(nodeCount * 2),
    createdDays: new Float32Array(nodeCount),
    modifiedDays: new Float32Array(nodeCount),
    degrees: new Uint32Array(nodeCount),
    nodeIds: new Uint32Array(nodeCount * 2),
    clusterIds: new Uint32Array(nodeCount),
    edges: new Uint32Array(edges),
    edgeDirections: new Uint32Array(edges.length / 2),
    edgeTypes: new Uint32Array(edges.length / 2).fill(1),
  };
}

describe('buildAdjacency', () => {
  it('lists both ends of every edge', () => {
    const adjacency = buildAdjacency(snapshot(4, [0, 1, 1, 2, 2, 3]));

    expect([...neighbours(adjacency, 0)]).toEqual([1]);
    expect([...neighbours(adjacency, 1)].sort()).toEqual([0, 2]);
    expect([...neighbours(adjacency, 3)]).toEqual([2]);
  });

  it('leaves an isolated note without neighbours', () => {
    const adjacency = buildAdjacency(snapshot(3, [0, 1]));

    expect(neighbours(adjacency, 2)).toHaveLength(0);
  });

  it('handles a graph without edges at all', () => {
    const adjacency = buildAdjacency(snapshot(2, []));

    expect(neighbours(adjacency, 0)).toHaveLength(0);
    expect(neighbours(adjacency, 1)).toHaveLength(0);
    expect([...adjacency.islandNodes]).toEqual([0, 0]);
  });

  it('skips tombstoned edge slots while scanning a topology snapshot', () => {
    const graph = snapshot(3, [0, 1, 1, 2, 0, 2]);
    graph.edgeCount = 2;
    graph.edgeSlotCount = 3;
    graph.edgeTypes.set([1, 0, 1]);

    expect([...neighbours(buildAdjacency(graph), 0)]).toEqual([1, 2]);
    expect([...neighbours(buildAdjacency(graph), 1)]).toEqual([0]);
    expect([...neighbours(buildAdjacency(graph), 2)]).toEqual([0]);
  });

  it('marks secondary connected components while leaving the dominant component and orphans alone', () => {
    const adjacency = buildAdjacency(snapshot(7, [0, 1, 1, 2, 2, 3, 4, 5]));

    expect([...adjacency.islandNodes]).toEqual([0, 0, 0, 0, 1, 1, 0]);
  });

  it('rebuilds island membership from the selected edge type', () => {
    const graph = snapshot(6, [0, 1, 1, 2, 2, 3, 4, 5]);
    graph.edgeTypes.set([1, 1, 1, 2]);

    expect([...buildAdjacency(graph).islandNodes]).toEqual([0, 0, 0, 0, 1, 1]);
    expect([...buildAdjacency(graph, 'wiki').islandNodes]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('keeps every neighbour of a hub', () => {
    const spokes = [0, 1, 0, 2, 0, 3, 0, 4, 0, 5];
    const adjacency = buildAdjacency(snapshot(6, spokes));

    expect([...neighbours(adjacency, 0)].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('builds routes from only the selected link type', () => {
    const graph = snapshot(3, [0, 1, 1, 2]);
    graph.edgeTypes.set([1, 2]);

    expect(shortestPath(buildAdjacency(graph, 'wiki'), 0, 2)).toBeNull();
    expect(shortestPath(buildAdjacency(graph, 'markdown'), 0, 2)).toBeNull();
    expect([...neighbours(buildAdjacency(graph, 'markdown'), 1)]).toEqual([2]);
  });

  it('applies sparse edge changes over the CSR base without rebuilding it', () => {
    const adjacency = buildAdjacency(snapshot(4, [0, 1, 1, 2]));
    const offsets = adjacency.offsets;
    const targets = adjacency.targets;

    expect(applyAdjacencyEdgeUpdates(adjacency, [
      { source: 0, target: 1, previousTypeMask: 1, typeMask: 0 },
      { source: 2, target: 3, previousTypeMask: 0, typeMask: 1 },
    ])).toBe(true);

    expect(adjacency.offsets).toBe(offsets);
    expect(adjacency.targets).toBe(targets);
    expect([...neighbours(adjacency, 0)]).toEqual([]);
    expect([...neighbours(adjacency, 1)]).toEqual([2]);
    expect([...neighbours(adjacency, 2)].sort()).toEqual([1, 3]);
    expect(shortestPath(adjacency, 0, 3)).toBeNull();
    const visited: number[] = [];
    visitLevels(adjacency, 2, 1, 10, (node) => visited.push(node));
    expect(visited).toEqual([2, 1, 3]);
  });

  it('updates type-filtered adjacency overlays when an edge changes type', () => {
    const graph = snapshot(2, [0, 1]);
    graph.edgeTypes[0] = 1;
    const adjacency = buildAdjacency(graph, 'wiki');

    applyAdjacencyEdgeUpdates(adjacency, [
      { source: 0, target: 1, previousTypeMask: 1, typeMask: 2 },
    ]);

    expect([...neighbours(adjacency, 0)]).toEqual([]);
  });

  it('requests compaction after the sparse overlay exceeds its bound', () => {
    const adjacency = buildAdjacency(snapshot(4_098, []));
    const updates = Array.from({ length: 2_049 }, (_, edge) => ({
      source: edge * 2,
      target: edge * 2 + 1,
      previousTypeMask: 0,
      typeMask: 1,
    }));

    expect(applyAdjacencyEdgeUpdates(adjacency, updates)).toBe(false);
    expect(adjacency.overlaySize).toBe(4_098);
  });
});

describe('visitLevels', () => {
  const chain = () => buildAdjacency(snapshot(5, [0, 1, 1, 2, 2, 3, 3, 4]));

  function levels(depth: number): Map<number, number> {
    const seen = new Map<number, number>();
    visitLevels(chain(), 0, depth, 1000, (node, level) => seen.set(node, level));
    return seen;
  }

  it('reaches only the neighbours at depth one', () => {
    expect([...levels(1).entries()]).toEqual([[0, 0], [1, 1]]);
  });

  it('walks one step further per depth', () => {
    expect([...levels(2).keys()]).toEqual([0, 1, 2]);
    expect([...levels(3).keys()]).toEqual([0, 1, 2, 3]);
  });

  it('gives every node its shortest distance', () => {
    expect(levels(3).get(3)).toBe(3);
  });

  it('visits a node once even when several paths lead to it', () => {
    const diamond = buildAdjacency(snapshot(4, [0, 1, 0, 2, 1, 3, 2, 3]));
    const visits: number[] = [];

    visitLevels(diamond, 0, 3, 1000, (node) => visits.push(node));

    expect(visits.sort()).toEqual([0, 1, 2, 3]);
  });

  it('stops once the limit is reached', () => {
    const hub = buildAdjacency(snapshot(6, [0, 1, 0, 2, 0, 3, 0, 4, 0, 5]));
    const visits: number[] = [];

    visitLevels(hub, 0, 2, 3, (node) => visits.push(node));

    expect(visits).toHaveLength(3);
  });

  it('lights a lone note without touching anything else', () => {
    const visits: number[] = [];

    visitLevels(buildAdjacency(snapshot(3, [0, 1])), 2, 3, 1000, (node) => visits.push(node));

    expect(visits).toEqual([2]);
  });
});

describe('shortestPath', () => {
  it('returns the shortest route through a branching graph', () => {
    const graph = buildAdjacency(snapshot(5, [0, 1, 1, 4, 0, 2, 2, 3, 3, 4]));

    expect(shortestPath(graph, 0, 4)).toEqual([0, 1, 4]);
  });

  it('returns a one-note path when both endpoints match', () => {
    expect(shortestPath(buildAdjacency(snapshot(2, [0, 1])), 1, 1)).toEqual([1]);
  });

  it('returns null when the endpoints are disconnected', () => {
    expect(shortestPath(buildAdjacency(snapshot(3, [0, 1])), 0, 2)).toBeNull();
  });

  it('rejects endpoints outside the graph', () => {
    const graph = buildAdjacency(snapshot(2, [0, 1]));

    expect(shortestPath(graph, -1, 1)).toBeNull();
    expect(shortestPath(graph, 0, 2)).toBeNull();
  });

  it('does not route through nodes excluded by the active view', () => {
    const graph = buildAdjacency(snapshot(3, [0, 1, 1, 2]));

    expect(shortestPath(graph, 0, 2, (node) => node !== 1)).toBeNull();
  });
});
