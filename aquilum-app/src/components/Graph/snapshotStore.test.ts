import { describe, expect, it } from 'vitest';
import { neighbours } from './adjacency';
import { SnapshotStore } from './snapshotStore';
import type { GraphSnapshot } from '../../modules/graph';

function fakeSnapshot(
  created: number[],
  modified: number[],
  positions = new Float32Array(created.length * 2),
  ids = Array.from({ length: created.length }, (_, index) => index + 1),
  edges: number[] = [],
  directions = new Uint32Array(edges.length / 2).fill(65),
  types = new Uint32Array(edges.length / 2).fill(1),
): GraphSnapshot {
  const nodeCount = created.length;
  return {
    nodeCount,
    edgeCount: edges.length / 2,
    epoch: { low: 1, high: 0 },
    positions,
    createdDays: new Float32Array(created),
    modifiedDays: new Float32Array(modified),
    degrees: new Uint32Array(nodeCount),
    nodeIds: new Uint32Array(ids.flatMap((id) => [id, 0])),
    clusterIds: new Uint32Array(nodeCount),
    edges: new Uint32Array(edges),
    edgeDirections: directions,
    edgeTypes: types,
  };
}

function scaleSnapshot(nodeCount: number, reverse: boolean): GraphSnapshot {
  const edgeCount = Math.max(nodeCount - 1, 0);
  const positions = new Float32Array(nodeCount * 2);
  const createdDays = new Float32Array(nodeCount);
  const modifiedDays = new Float32Array(nodeCount);
  const degrees = new Uint32Array(nodeCount);
  const nodeIds = new Uint32Array(nodeCount * 2);
  const clusterIds = new Uint32Array(nodeCount);
  const edges = new Uint32Array(edgeCount * 2);
  const edgeDirections = new Uint32Array(edgeCount).fill(65);
  const edgeTypes = new Uint32Array(edgeCount).fill(1);
  for (let node = 0; node < nodeCount; node += 1) {
    const id = reverse ? nodeCount - node : node + 1;
    positions[node * 2] = reverse ? -node : node;
    positions[node * 2 + 1] = node % 11;
    nodeIds[node * 2] = id;
    clusterIds[node] = Math.floor(node / 10);
    if (node < edgeCount) {
      edges[node * 2] = node;
      edges[node * 2 + 1] = node + 1;
      degrees[node] += 1;
      degrees[node + 1] += 1;
    }
  }
  return {
    nodeCount,
    edgeCount,
    epoch: { low: reverse ? 2 : 1, high: 0 },
    positions,
    createdDays,
    modifiedDays,
    degrees,
    nodeIds,
    clusterIds,
    edges,
    edgeDirections,
    edgeTypes,
  };
}

describe('SnapshotStore date ranges', () => {
  it('applies sparse modified dates and advances the freshness minimum', () => {
    const store = new SnapshotStore();
    const snapshot = fakeSnapshot([1, 2, 3], [10, 20, 30]);
    store.adopt(snapshot, false);

    expect(store.applyModifiedDateUpdates([
      { index: 1, modifiedDay: 25 },
      { index: 2, modifiedDay: 40 },
    ])).toBe(true);
    expect([...snapshot.modifiedDays]).toEqual([10, 25, 40]);
    expect(store.freshness).toEqual({ oldest: 10, newest: 40 });
    expect(store.applyModifiedDateUpdates([{ index: 0, modifiedDay: 50 }])).toBe(true);
    expect(store.freshness).toEqual({ oldest: 25, newest: 50 });
  });

  it.each([
    [{ index: -1, modifiedDay: 50 }],
    [{ index: 1.5, modifiedDay: 50 }],
    [{ index: 2, modifiedDay: 50 }],
    [{ index: 0, modifiedDay: Number.NaN }],
    [{ index: 0, modifiedDay: Number.POSITIVE_INFINITY }],
    [{ index: 0, modifiedDay: 9 }],
  ])('rejects invalid sparse modified date updates atomically: %j', (invalid) => {
    const store = new SnapshotStore();
    const snapshot = fakeSnapshot([1, 2], [10, 20]);
    store.adopt(snapshot, false);

    expect(store.applyModifiedDateUpdates([
      { index: 0, modifiedDay: 30 },
      invalid,
    ])).toBe(false);
    expect([...snapshot.modifiedDays]).toEqual([10, 20]);
    expect(store.freshness).toEqual({ oldest: 10, newest: 20 });
  });

  it('computes exact date ranges without artificial day padding', () => {
    const store = new SnapshotStore();
    store.adopt(fakeSnapshot([100.1, 100.2, 100.5], [200.1, 200.8]), false);

    expect(store.created.oldest).toBeCloseTo(100.1);
    expect(store.created.newest).toBeCloseTo(100.5);
    expect(store.freshness.oldest).toBeCloseTo(200.1);
    expect(store.freshness.newest).toBeCloseTo(200.8);
  });

  it('bounds the freshness minimum index during repeated unique date updates', () => {
    const store = new SnapshotStore();
    store.adopt(fakeSnapshot([1, 2], [1, 100]), false);
    const index = store as unknown as {
      freshnessCounts: Map<number, number>;
      freshnessHeap: number[];
    };

    for (let day = 101; day < 201; day += 1) {
      expect(store.applyModifiedDateUpdates([{ index: 1, modifiedDay: day }])).toBe(true);
    }

    expect(index.freshnessCounts.size).toBe(2);
    expect(index.freshnessHeap.length).toBeLessThanOrEqual(36);
    expect(store.freshness).toEqual({ oldest: 1, newest: 200 });
  });

  it('keeps identical dates without adding an artificial day', () => {
    const store = new SnapshotStore();
    store.adopt(fakeSnapshot([50, 50, 50], [60, 60]), false);

    expect(store.created.oldest).toBe(50);
    expect(store.created.newest).toBe(50);
    expect(store.freshness.oldest).toBe(60);
    expect(store.freshness.newest).toBe(60);
  });

  it('skips non-finite dates when computing bounds', () => {
    const store = new SnapshotStore();
    store.adopt(fakeSnapshot([Number.NaN, 10, Number.POSITIVE_INFINITY, 25], [Number.NaN, 30]), false);

    expect(store.created.oldest).toBe(10);
    expect(store.created.newest).toBe(25);
    expect(store.freshness.oldest).toBe(30);
    expect(store.freshness.newest).toBe(30);
  });

  it('falls back to zero bounds when no dates are finite', () => {
    const store = new SnapshotStore();
    store.adopt(fakeSnapshot([Number.NaN], [Number.NaN]), false);

    expect(store.created).toEqual({ oldest: 0, newest: 0 });
    expect(store.freshness).toEqual({ oldest: 0, newest: 0 });
  });
});

describe('SnapshotStore community collapse', () => {
  it('rewires inter-community links to stable hubs and restores them on expansion', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      undefined,
      undefined,
      [0, 2, 1, 3, 0, 1],
    );
    snapshot.clusterIds.set([0, 0, 1, 1]);
    snapshot.degrees.set([1, 4, 2, 3]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);

    expect(store.setCollapsedCommunities([0, 1], null)).toBe(true);
    expect([...store.collapsedNodeMask!]).toEqual([0, 1, 0, 1]);
    expect([...store.renderEdges]).toEqual([1, 3]);
    expect([...store.adjacency!.targets]).toEqual([3, 1]);

    expect(store.setCollapsedCommunities([], null)).toBe(true);
    expect(store.collapsedNodeMask).toBeNull();
    expect([...store.renderEdges]).toEqual([0, 2, 1, 3, 0, 1]);
  });

  it('does not retain links from notes excluded by active filters', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      undefined,
      undefined,
      [0, 2, 1, 2],
    );
    snapshot.clusterIds.set([0, 0, 1]);
    snapshot.degrees.set([1, 2, 1]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);

    store.setCollapsedCommunities([0], new Uint8Array([1, 1, 0]));

    expect([...store.renderEdges]).toEqual([]);
    expect([...store.collapsedNodeMask!]).toEqual([0, 1, 1]);

    store.setCollapsedCommunities([0], new Uint8Array([1, 1, 1]));

    expect([...store.renderEdges]).toEqual([1, 2]);
  });

  it('uses an eligible community member when its highest-degree hub is filtered out', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      undefined,
      undefined,
      [0, 2, 1, 2],
    );
    snapshot.clusterIds.set([0, 0, 1]);
    snapshot.degrees.set([9, 2, 1]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);

    store.setCollapsedCommunities(
      [0],
      new Uint8Array([0, 1, 1]),
      new Uint8Array([0, 1, 1]),
    );

    expect([...store.collapsedNodeMask!]).toEqual([0, 1, 1]);
    expect([...store.renderEdges]).toEqual([1, 2]);
  });
});

describe('SnapshotStore typed edge direction', () => {
  it('filters direction by relation type before building arrow edges', () => {
    const snapshot = fakeSnapshot(
      [1, 1],
      [1, 1],
      undefined,
      undefined,
      [0, 1],
      new Uint32Array([1 | (2 << 6)]),
      new Uint32Array([1 | 2]),
    );
    const store = new SnapshotStore();
    store.adopt(snapshot, false);

    store.setEdgeType('markdown');

    expect([...store.renderEdgeDirections]).toEqual([2]);
    expect([...store.renderArrowEdges]).toEqual([1, 0]);
  });
});

describe('SnapshotStore topology deltas', () => {
  it.each([100, 1_000, 10_000, 100_000])(
    'keeps edge buffers and adjacency for node-only updates at %i nodes',
    (nodeCount) => {
      const snapshot = scaleSnapshot(nodeCount, false);
      const store = new SnapshotStore();
      store.adopt(snapshot, false);
      const edges = store.renderEdges;
      const adjacency = store.adjacency;

      expect(store.applyTopologyDelta({
        baseEpochLow: 1,
        baseEpochHigh: 0,
        revision: 1,
        edgeSlotCount: snapshot.edgeCount,
        edgeCount: snapshot.edgeCount,
        metricsStale: false,
        nodeUpdates: [{ index: 0, degree: 7, modifiedDay: 4 }],
        edgeUpdates: [],
      }, 0)).toBe(true);

      expect(store.renderEdges).toBe(edges);
      expect(store.adjacency).toBe(adjacency);
      expect(snapshot.degrees[0]).toBe(7);
      expect(snapshot.modifiedDays[0]).toBe(4);
    },
  );

  it('applies slot tombstones and appended edges atomically to rendering and traversal', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      undefined,
      undefined,
      [0, 1, 1, 2],
    );
    snapshot.degrees.set([1, 2, 1]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    const adjacencyOffsets = store.adjacency!.offsets;
    const adjacencyTargets = store.adjacency!.targets;

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 3,
      edgeCount: 2,
      metricsStale: true,
      nodeUpdates: [
        { index: 0, degree: 1, modifiedDay: 10 },
        { index: 1, degree: 1 },
        { index: 2, degree: 2 },
      ],
      edgeUpdates: [
        { slot: 0, source: 0, target: 1, directionMask: 0, typeMask: 0 },
        { slot: 2, source: 0, target: 2, directionMask: 65, typeMask: 1 },
      ],
    }, 0)).toBe(true);

    expect(snapshot.edgeCount).toBe(2);
    expect(snapshot.edgeSlotCount).toBe(3);
    expect(snapshot.metricsStale).toBe(true);
    expect([...snapshot.degrees]).toEqual([1, 1, 2]);
    expect([...snapshot.modifiedDays]).toEqual([10, 1, 1]);
    expect(store.freshness).toEqual({ oldest: 1, newest: 10 });
    expect([...store.renderEdges]).toEqual([1, 2, 0, 2]);
    expect(store.adjacency!.offsets).toBe(adjacencyOffsets);
    expect(store.adjacency!.targets).toBe(adjacencyTargets);
    expect([...neighbours(store.adjacency!, 0)]).toEqual([2]);
    expect([...neighbours(store.adjacency!, 1)]).toEqual([2]);
    expect([...neighbours(store.adjacency!, 2)].sort()).toEqual([0, 1]);
  });

  it('keeps dense render slots stable across add, delete, and direction updates', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      undefined,
      undefined,
      [0, 1, 1, 2, 2, 3],
      new Uint32Array([1, 128, 1]),
      new Uint32Array([1, 2, 1]),
    );
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    const edgeBuffer = store.renderEdges.buffer;
    const arrowBuffer = store.renderArrowEdges.buffer;

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 4,
      edgeCount: 3,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates: [
        { slot: 0, source: 0, target: 1, directionMask: 0, typeMask: 0 },
        { slot: 1, source: 1, target: 2, directionMask: 2, typeMask: 2 },
        { slot: 3, source: 0, target: 3, directionMask: 1, typeMask: 1 },
      ],
    }, 0)).toBe(true);

    expect([...store.renderEdges]).toEqual([2, 3, 1, 2, 0, 3]);
    expect([...store.renderEdgeDirections]).toEqual([1, 1, 1]);
    expect([...store.renderArrowEdges]).toEqual([2, 3, 1, 2, 0, 3]);
    expect(store.renderEdges.buffer).toBe(edgeBuffer);
    expect(store.renderArrowEdges.buffer).toBe(arrowBuffer);
    expect(store.changedRenderEdgeIndices).toEqual([0, 2]);
    expect(store.changedRenderArrowIndices).toEqual([0, 1, 1, 2]);
  });

  it('updates filtered edge views sparsely after swap-delete and repairs arrow membership', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      undefined,
      undefined,
      [0, 1, 1, 2, 2, 3],
      new Uint32Array([1, 1, 1]),
      new Uint32Array([1, 1, 2]),
    );
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    store.setEdgeType('wiki');

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 4,
      edgeCount: 3,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates: [
        { slot: 0, source: 0, target: 1, directionMask: 0, typeMask: 0 },
        { slot: 3, source: 0, target: 3, directionMask: 1, typeMask: 1 },
      ],
    }, 0)).toBe(true);

    expect(store.sparseEdgeUpdate).toBe(true);
    expect([...store.renderEdges]).toEqual([1, 2, 0, 3]);
    expect([...store.renderEdgeDirections]).toEqual([1, 1]);
    expect([...store.renderArrowEdges]).toEqual([1, 2, 0, 3]);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 2,
      edgeSlotCount: 4,
      edgeCount: 2,
      metricsStale: false,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 3, source: 0, target: 3, directionMask: 0, typeMask: 0 }],
    }, 1)).toBe(true);
    expect([...store.renderEdges]).toEqual([1, 2]);
    expect([...store.renderArrowEdges]).toEqual([1, 2]);
    store.setEdgeType('all');
    expect([...store.renderEdges]).toEqual([1, 2, 2, 3]);
  });

  it('retains projected mask bits until every raw contributor is removed', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      undefined,
      undefined,
      [0, 2, 1, 3],
      new Uint32Array([1, 1]),
      new Uint32Array([1, 1]),
    );
    snapshot.clusterIds.set([0, 0, 1, 1]);
    snapshot.degrees.set([1, 5, 1, 5]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    store.setCollapsedCommunities([0, 1], null);
    expect([...store.renderEdges]).toEqual([1, 3]);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 2,
      edgeCount: 1,
      metricsStale: false,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 0, source: 0, target: 2, directionMask: 0, typeMask: 0 }],
    }, 0)).toBe(true);

    expect(store.sparseEdgeUpdate).toBe(true);
    expect([...store.renderEdges]).toEqual([1, 3]);
    expect([...store.renderEdgeTypes]).toEqual([1]);
    expect([...store.renderEdgeDirections]).toEqual([1]);
    expect([...neighbours(store.adjacency!, 1)]).toEqual([3]);
    expect([...neighbours(store.adjacency!, 3)]).toEqual([1]);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 2,
      edgeSlotCount: 2,
      edgeCount: 0,
      metricsStale: false,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 1, source: 1, target: 3, directionMask: 0, typeMask: 0 }],
    }, 1)).toBe(true);
    expect(store.renderEdges).toHaveLength(0);
    expect([...neighbours(store.adjacency!, 1)]).toEqual([]);
    expect([...snapshot.edgeTypes]).toEqual([0, 0]);

    const freshStore = new SnapshotStore();
    freshStore.adopt(structuredClone(snapshot), false);
    expect([...freshStore.snapshot!.edgeTypes]).toEqual([0, 0]);
    freshStore.setCollapsedCommunities([0, 1], null);
    expect(Array.from({ length: snapshot.nodeCount }, (_, node) => [...neighbours(store.adjacency!, node)]))
      .toEqual(Array.from({ length: snapshot.nodeCount }, (_, node) => [...neighbours(freshStore.adjacency!, node)]));
  });

  it('adds and removes raw slots as their types cross the active filter', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      undefined,
      undefined,
      [0, 1, 1, 2],
      new Uint32Array([1, 1]),
      new Uint32Array([1, 2]),
    );
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    store.setEdgeType('wiki');
    expect([...store.renderEdges]).toEqual([0, 1]);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 2,
      edgeCount: 2,
      metricsStale: false,
      nodeUpdates: [],
      edgeUpdates: [
        { slot: 0, source: 0, target: 1, directionMask: 1, typeMask: 2 },
        { slot: 1, source: 1, target: 2, directionMask: 1, typeMask: 1 },
      ],
    }, 0)).toBe(true);

    expect([...store.renderEdges]).toEqual([1, 2]);
    expect([...store.renderArrowEdges]).toEqual([1, 2]);
  });

  it('incrementally changes collapsed direction and arrow orientation masks', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      undefined,
      undefined,
      [0, 2, 1, 3],
      new Uint32Array([1, 128]),
      new Uint32Array([1, 2]),
    );
    snapshot.clusterIds.set([0, 0, 1, 1]);
    snapshot.degrees.set([1, 5, 1, 5]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    store.setCollapsedCommunities([0, 1], null);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 2,
      edgeCount: 2,
      metricsStale: false,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 0, source: 0, target: 2, directionMask: 0, typeMask: 1 }],
    }, 0)).toBe(true);

    expect(store.sparseEdgeUpdate).toBe(true);
    expect([...store.renderEdges]).toEqual([1, 3]);
    expect([...store.renderEdgeDirections]).toEqual([2]);
    expect([...store.renderEdgeTypes]).toEqual([2]);
    expect([...store.renderArrowEdges]).toEqual([3, 1]);
  });

  it('drops a newly appended raw edge that becomes a self-edge after collapse', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      undefined,
      undefined,
      [1, 2],
      new Uint32Array([1]),
      new Uint32Array([1]),
    );
    snapshot.clusterIds.set([0, 0, 1]);
    snapshot.degrees.set([1, 5, 1]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    store.setCollapsedCommunities([0], null);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 2,
      edgeCount: 2,
      metricsStale: false,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 1, source: 0, target: 1, directionMask: 1, typeMask: 1 }],
    }, 0)).toBe(true);

    expect([...store.renderEdges]).toEqual([1, 2]);
    expect([...neighbours(store.adjacency!, 1)]).toEqual([2]);
  });

  it('rejects a collapsed delta before a changed degree can select a different representative', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      undefined,
      undefined,
      [0, 2],
    );
    snapshot.clusterIds.set([0, 0, 1]);
    snapshot.degrees.set([1, 5, 1]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    store.setCollapsedCommunities([0], null);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 1,
      edgeCount: 1,
      metricsStale: false,
      nodeUpdates: [{ index: 0, degree: 6 }],
      edgeUpdates: [{ slot: 0, source: 0, target: 2, directionMask: 0, typeMask: 1 }],
    }, 0)).toBe(false);

    expect(snapshot.degrees[0]).toBe(1);
    expect([...store.renderEdges]).toEqual([1, 2]);
  });

  it('rejects collapsed deltas when global metrics invalidate the projection', () => {
    const snapshot = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      undefined,
      undefined,
      [0, 2],
    );
    snapshot.clusterIds.set([0, 0, 1]);
    snapshot.degrees.set([1, 5, 1]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    store.setCollapsedCommunities([0], null);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 2,
      edgeCount: 2,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 1, source: 0, target: 1, directionMask: 1, typeMask: 1 }],
    }, 0)).toBe(false);

    expect(snapshot.edgeSlotCount).toBeUndefined();
    expect(snapshot.edgeTypes[0]).toBe(1);
    expect(snapshot.metricsStale).toBeUndefined();
    expect([...store.renderEdges]).toEqual([1, 2]);
  });

  it('rebuilds CSR on overlay overflow without losing dense edge updates', () => {
    const nodeCount = 4_100;
    const snapshot = fakeSnapshot(
      new Array(nodeCount).fill(1),
      new Array(nodeCount).fill(1),
    );
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    const edgeUpdates = Array.from({ length: 2_049 }, (_, slot) => ({
      slot,
      source: slot,
      target: slot + 1,
      directionMask: 1,
      typeMask: 1,
    }));

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: edgeUpdates.length,
      edgeCount: edgeUpdates.length,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates,
    }, 0)).toBe(true);

    expect(store.renderEdges.length).toBe(edgeUpdates.length * 2);
    expect(store.adjacency?.overlay).toBeUndefined();
    expect([...neighbours(store.adjacency!, 0)]).toEqual([1]);
    expect([...neighbours(store.adjacency!, 2_048)]).toEqual([2_047, 2_049]);
  });

  it('rejects invalid updates without mutating the snapshot or derived graph', () => {
    const snapshot = fakeSnapshot([1, 1], [1, 1], undefined, undefined, [0, 1]);
    snapshot.degrees.set([1, 1]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);
    const edges = [...store.renderEdges];
    const adjacency = store.adjacency;

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 2,
      edgeCount: 1,
      metricsStale: true,
      nodeUpdates: [{ index: 0, degree: 7 }],
      edgeUpdates: [
        { slot: 0, source: 0, target: 1, directionMask: 0, typeMask: 0 },
        { slot: 1, source: 0, target: 9, directionMask: 65, typeMask: 1 },
      ],
    }, 0)).toBe(false);

    expect([...snapshot.degrees]).toEqual([1, 1]);
    expect(snapshot.edgeCount).toBe(1);
    expect([...store.renderEdges]).toEqual(edges);
    expect(store.adjacency).toBe(adjacency);
  });

  it('does not let an existing edge slot change its endpoint identity', () => {
    const snapshot = fakeSnapshot([1, 1, 1], [1], undefined, undefined, [0, 1]);
    const store = new SnapshotStore();
    store.adopt(snapshot, false);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 1,
      edgeCount: 1,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates: [{ slot: 0, source: 0, target: 2, directionMask: 65, typeMask: 1 }],
    }, 0)).toBe(false);
    expect([...snapshot.edges]).toEqual([0, 1]);
    expect([...store.renderEdges]).toEqual([0, 1]);
  });

  it('keeps stale global metrics stale across deltas that do not change edges', () => {
    const snapshot = fakeSnapshot([1], [1]);
    snapshot.metricsStale = true;
    const store = new SnapshotStore();
    store.adopt(snapshot, false);

    expect(store.applyTopologyDelta({
      baseEpochLow: 1,
      baseEpochHigh: 0,
      revision: 1,
      edgeSlotCount: 0,
      edgeCount: 0,
      metricsStale: false,
      nodeUpdates: [],
      edgeUpdates: [],
    }, 0)).toBe(true);
    expect(snapshot.metricsStale).toBe(true);
  });

  it('rejects topology deltas while a snapshot morph is active', () => {
    const store = new SnapshotStore();
    store.adopt(fakeSnapshot([1], [1], undefined, [101]), false);
    const next = fakeSnapshot([1], [1], new Float32Array([10, 10]), [101]);
    store.adopt(next, store.morphsInto(next, true));

    expect(store.applyTopologyDelta({
      baseEpochLow: next.epoch.low,
      baseEpochHigh: next.epoch.high,
      revision: 1,
      edgeSlotCount: 0,
      edgeCount: 0,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates: [],
    }, 0)).toBe(false);
    expect(store.isMorphing()).toBe(true);
  });
});

describe('SnapshotStore transitions', () => {
  it('filters rendered edges and graph traversal by link type', () => {
    const store = new SnapshotStore();
    store.adopt(
      fakeSnapshot(
        [1, 1, 1],
        [1, 1, 1],
        undefined,
        undefined,
        [0, 1, 1, 2],
        new Uint32Array([65, 130]),
        new Uint32Array([1, 2]),
      ),
      false,
    );

    store.setEdgeType('markdown');

    expect([...store.renderEdges]).toEqual([1, 2]);
    expect([...store.adjacency!.targets]).toEqual([2, 1]);
  });

  it.each([
    ['outgoing', [1], [0, 1]],
    ['incoming', [2], [1, 0]],
  ] as const)('shows %s links from the focused node', (direction, masks, arrows) => {
    const store = new SnapshotStore();
    store.adopt(fakeSnapshot([1, 1], [1, 1], undefined, undefined, [0, 1]), false);
    const adjacency = store.adjacency;

    store.setEdgeDirection(direction, 0);

    expect([...store.renderEdgeDirections]).toEqual(masks);
    expect([...store.renderArrowEdges]).toEqual(arrows);
    expect(store.adjacency).toBe(adjacency);
  });

  it('builds arrow instances only for directed edge orientations', () => {
    const store = new SnapshotStore();
    store.adopt(
      fakeSnapshot([1, 1, 1, 1], [1, 1, 1, 1], undefined, undefined, [0, 1, 1, 2, 2, 3], new Uint32Array([1, 64, 129])),
      false,
    );

    expect([...store.renderArrowEdges]).toEqual([0, 1, 2, 1, 2, 3, 3, 2]);
  });

  it('matches nodes by stable identity after PageRank reorders the snapshot', () => {
    const store = new SnapshotStore();
    const before = fakeSnapshot(
      [1, 1],
      [1, 1],
      new Float32Array([-10, 2, 30, 4]),
      [101, 202],
    );
    const after = fakeSnapshot(
      [1, 1],
      [1, 1],
      new Float32Array([80, 6, -70, 8]),
      [202, 101],
    );
    store.adopt(before, false);

    store.adopt(after, store.morphsInto(after, true));

    expect(store.x(0)).toBe(30);
    expect(store.y(0)).toBe(4);
    expect(store.x(1)).toBe(-10);
    expect(store.y(1)).toBe(2);
    store.finishMorph();
    expect(store.x(0)).toBe(80);
    expect(store.x(1)).toBe(-70);
  });

  it('starts added nodes at the mean position of their surviving neighbours', () => {
    const store = new SnapshotStore();
    const before = fakeSnapshot(
      [1, 1],
      [1, 1],
      new Float32Array([-8, 4, 12, 6]),
      [101, 202],
    );
    const after = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      new Float32Array([0, 0, 0, 0, 60, 60]),
      [101, 202, 303],
      [0, 2, 1, 2],
    );
    store.adopt(before, false);

    store.adopt(after, store.morphsInto(after, true));

    expect(store.x(2)).toBe(2);
    expect(store.y(2)).toBe(5);
  });

  it('keeps removed nodes as temporary render ghosts and retains their old links', () => {
    const store = new SnapshotStore();
    const before = fakeSnapshot(
      [1, 1],
      [1, 1],
      new Float32Array([-8, 4, 12, 6]),
      [101, 202],
      [0, 1],
    );
    const after = fakeSnapshot(
      [1, 1],
      [1, 1],
      new Float32Array([0, 0, 60, 60]),
      [101, 303],
      [0, 1],
    );
    store.adopt(before, false);

    store.adopt(after, store.morphsInto(after, true));

    expect(store.enteringNodes).toEqual([1]);
    expect(store.renderNodeCount).toBe(3);
    expect([...store.renderEdges]).toEqual([0, 2]);
    expect([...store.renderTransitionEdges]).toEqual([0, 1]);
    expect([...store.renderTransitionEdgeTarget]).toEqual([1]);
    expect(store.x(2)).toBe(12);
    expect(store.y(2)).toBe(6);
    store.setEdgeType('wiki');
    store.finishMorph();
    store.dropGhosts();
    expect(store.renderNodeCount).toBe(2);
    expect([...store.renderEdges]).toEqual([0, 1]);
  });

  it('updates a dragged node in place and rebuilds picking data on release', () => {
    const store = new SnapshotStore();
    store.adopt(fakeSnapshot([1], [1], new Float32Array([1, 2]), [101]), false);

    store.moveNode(0, 8, 9);

    expect(store.takeMovedNode()).toBe(0);
    expect(store.x(0)).toBe(8);
    expect(store.y(0)).toBe(9);
    expect(store.snapshot?.positions[0]).toBe(8);
    expect(store.finishPositionEdit()).toBe(true);
    expect(store.finishPositionEdit()).toBe(false);
  });

  it('fades replaced links between surviving nodes out and in by stable identity', () => {
    const store = new SnapshotStore();
    const before = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      new Float32Array([0, 0, 1, 1, 2, 2]),
      [101, 202, 303],
      [0, 1],
    );
    const after = fakeSnapshot(
      [1, 1, 1],
      [1, 1, 1],
      new Float32Array([10, 10, 20, 20, 30, 30]),
      [303, 101, 202],
      [0, 2],
    );
    store.adopt(before, false);

    store.adopt(after, store.morphsInto(after, true));

    expect([...store.renderEdges]).toEqual([]);
    expect([...store.renderTransitionEdges]).toEqual([0, 2, 1, 2]);
    expect([...store.renderTransitionEdgeTarget]).toEqual([1, 0]);
    expect([...store.renderTransitionArrowTarget]).toEqual([1, 1, 0, 0]);
    const edgeTargets = store.renderTransitionEdgeTarget;
    store.advanceMorph(0.225);
    expect(store.renderTransitionEdgeTarget).toBe(edgeTargets);
    expect(store.transitionProgress).toBe(0.5);
    store.finishMorph();
    expect([...store.renderEdges]).toEqual([0, 2]);
    expect(store.renderTransitionEdges).toHaveLength(0);
  });

  it('reuses transition targets while advancing a dense changed-edge snapshot', () => {
    const store = new SnapshotStore();
    const before = scaleSnapshot(10_000, false);
    before.edgeDirections.fill(1);
    const after = scaleSnapshot(10_000, false);
    after.epoch.low = 2;
    after.edgeDirections.fill(64);
    store.adopt(before, false);

    store.adopt(after, store.morphsInto(after, true));

    const targets = store.renderTransitionEdgeTarget;
    expect(targets).toHaveLength(after.edgeCount * 2);
    expect(store.renderTransitionArrowTarget).toHaveLength(after.edgeCount * 2);
    store.advanceMorph(1 / 60);
    expect(store.renderTransitionEdgeTarget).toBe(targets);
  });

  it('keeps transition targets aligned when link filters change mid-morph', () => {
    const store = new SnapshotStore();
    const before = fakeSnapshot(
      [1, 1],
      [1, 1],
      undefined,
      [101, 202],
      [0, 1],
      new Uint32Array([1]),
      new Uint32Array([1]),
    );
    const after = fakeSnapshot(
      [1, 1],
      [1, 1],
      undefined,
      [101, 202],
      [0, 1],
      new Uint32Array([2]),
      new Uint32Array([2]),
    );
    store.adopt(before, false);
    store.adopt(after, store.morphsInto(after, true));

    store.setEdgeType('markdown');

    expect([...store.renderTransitionEdges]).toEqual([0, 1]);
    expect([...store.renderTransitionEdgeTarget]).toEqual([1]);
    expect([...store.renderTransitionArrowTarget]).toEqual([1]);
    store.finishMorph();
    expect([...store.renderEdges]).toEqual([0, 1]);
    expect(store.renderTransitionEdges).toHaveLength(0);
  });

  it('keeps removed-node ghosts until the latest queued snapshot can be adopted', () => {
    const store = new SnapshotStore();
    const first = fakeSnapshot([1], [1], new Float32Array([1, 2]), [101]);
    const active = fakeSnapshot([1], [1], new Float32Array([3, 4]), [202]);
    const stale = fakeSnapshot([1], [1], new Float32Array([5, 6]), [303]);
    const latest = fakeSnapshot([1], [1], new Float32Array([7, 8]), [404]);
    store.adopt(first, false);
    store.adopt(active, store.morphsInto(active, true));

    store.queueSnapshot(stale, true);
    store.queueSnapshot(latest, true);

    expect(store.snapshot).toBe(active);
    expect(store.hasGhosts).toBe(true);
    store.finishMorph();
    store.dropGhosts();
    expect(store.takeQueuedSnapshot()).toEqual({ snapshot: latest, keepCamera: true });
    expect(store.takeQueuedSnapshot()).toBeNull();
  });

  it.each([
    ['direction', 1, 64, 1, 1],
    ['type', 1, 1, 1, 2],
  ])('fades an edge whose %s changes while its endpoints survive', (
    change,
    beforeDirection,
    afterDirection,
    beforeType,
    afterType,
  ) => {
    const store = new SnapshotStore();
    const before = fakeSnapshot(
      [1, 1],
      [1, 1],
      undefined,
      [101, 202],
      [0, 1],
      new Uint32Array([change === 'direction' ? beforeDirection : 3]),
      new Uint32Array([change === 'type' ? beforeType : 1]),
    );
    const after = fakeSnapshot(
      [1, 1],
      [1, 1],
      undefined,
      [101, 202],
      [0, 1],
      new Uint32Array([change === 'direction' ? afterDirection : 3]),
      new Uint32Array([change === 'type' ? afterType : 1]),
    );
    store.adopt(before, false);

    store.adopt(after, store.morphsInto(after, true));

    expect(store.renderEdges).toHaveLength(0);
    expect(store.renderTransitionEdges).toHaveLength(4);
    expect([...store.renderTransitionEdgeTarget]).toEqual([1, 0]);
    store.finishMorph();
    expect([...store.renderEdges]).toEqual([0, 1]);
    expect(store.renderTransitionEdges).toHaveLength(0);
  });

  it('reclassifies islands when the active link type changes', () => {
    const store = new SnapshotStore();
    store.adopt(fakeSnapshot(
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      undefined,
      undefined,
      [0, 1, 1, 2, 2, 3, 4, 5],
      undefined,
      new Uint32Array([1, 1, 1, 2]),
    ), false);

    expect([...store.islandNodes]).toEqual([0, 0, 0, 0, 1, 1]);

    store.setEdgeType('wiki');

    expect([...store.islandNodes]).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it.each([100, 1_000, 10_000, 100_000])(
    'matches reordered stable IDs in a %i-node snapshot',
    (nodeCount) => {
      const store = new SnapshotStore();
      const before = scaleSnapshot(nodeCount, false);
      const after = scaleSnapshot(nodeCount, true);
      store.adopt(before, false);

      store.adopt(after, store.morphsInto(after, true));

      expect(store.isMorphing()).toBe(true);
      expect(store.x(0)).toBe(nodeCount - 1);
      store.finishMorph();
      expect(store.x(0)).toBe(0);
    },
  );
});
