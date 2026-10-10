import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { decodeGraphSnapshot, loadGraphClusterIds, loadGraphFilterNodes, loadGraphModifiedDateDelta, loadGraphSnapshot, loadGraphTimelineEvents, loadGraphTimelineEventsThrough, loadGraphTimelineRange, loadGraphTimelineSnapshot, loadGraphTopologyDelta, saveGraphPositions } from './gateway';
import { graphBounds } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const HEADER_BYTES = 16;

function encode(epochLow = 7, epochHigh = 0): ArrayBuffer {
  const nodeCount = 2;
  const edgeCount = 1;
  const buffer = new ArrayBuffer(HEADER_BYTES + nodeCount * 32 + edgeCount * 16);
  const header = new DataView(buffer);
  header.setUint32(0, nodeCount, true);
  header.setUint32(4, edgeCount, true);
  header.setUint32(8, epochLow, true);
  header.setUint32(12, epochHigh, true);
  new Float32Array(buffer, HEADER_BYTES, 4).set([-1, -2, 3, 4]);
  new Float32Array(buffer, HEADER_BYTES + 16, 2).set([100, 200]);
  new Float32Array(buffer, HEADER_BYTES + 24, 2).set([300, 400]);
  new Uint32Array(buffer, HEADER_BYTES + 32, 2).set([1, 1]);
  new Uint32Array(buffer, HEADER_BYTES + 40, 4).set([1, 0, 2, 0]);
  new Uint32Array(buffer, HEADER_BYTES + 56, 2).set([7, 7]);
  new Uint32Array(buffer, HEADER_BYTES + 64, 2).set([0, 1]);
  new Uint32Array(buffer, HEADER_BYTES + 72, 1).set([129]);
  new Uint32Array(buffer, HEADER_BYTES + 76, 1).set([2]);
  return buffer;
}

describe('decodeGraphSnapshot', () => {
  it('reads the header and maps every section onto the same buffer', () => {
    const snapshot = decodeGraphSnapshot(encode());

    expect(snapshot.nodeCount).toBe(2);
    expect(snapshot.edgeCount).toBe(1);
    expect([...snapshot.positions]).toEqual([-1, -2, 3, 4]);
    expect([...snapshot.createdDays]).toEqual([100, 200]);
    expect([...snapshot.modifiedDays]).toEqual([300, 400]);
    expect([...snapshot.degrees]).toEqual([1, 1]);
    expect([...snapshot.nodeIds]).toEqual([1, 0, 2, 0]);
    expect([...snapshot.clusterIds]).toEqual([7, 7]);
    expect([...snapshot.edges]).toEqual([0, 1]);
    expect([...snapshot.edgeDirections]).toEqual([129]);
    expect([...snapshot.edgeTypes]).toEqual([2]);
  });

  it('carries the epoch that names the node numbering', () => {
    const snapshot = decodeGraphSnapshot(encode(0xdeadbeef, 7));

    expect(snapshot.epoch).toEqual({ low: 0xdeadbeef, high: 7 });
  });

  it('does not copy the payload out of the transferred buffer', () => {
    const buffer = encode();

    const snapshot = decodeGraphSnapshot(buffer);

    expect(snapshot.positions.buffer).toBe(buffer);
    expect(snapshot.nodeIds.buffer).toBe(buffer);
    expect(snapshot.clusterIds.buffer).toBe(buffer);
    expect(snapshot.edges.buffer).toBe(buffer);
  });

  it('bounds cover every node with padding', () => {
    const bounds = graphBounds(decodeGraphSnapshot(encode()));

    expect(bounds.minX).toBeLessThan(-1);
    expect(bounds.maxY).toBeGreaterThan(4);
  });

  it('an empty graph still yields usable bounds', () => {
    const buffer = new ArrayBuffer(HEADER_BYTES);

    const bounds = graphBounds(decodeGraphSnapshot(buffer));

    expect(bounds.maxX).toBeGreaterThan(bounds.minX);
    expect(bounds.maxY).toBeGreaterThan(bounds.minY);
  });
});

describe('loadGraphFilterNodes', () => {
  it('sends graph identity and only active metadata filters to Tauri', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([1, 4]);

    const result = await loadGraphFilterNodes('C:/vault', { low: 2, high: 3 }, {
      folder: 'Projects',
      tag: '',
      propertyKey: 'type',
      propertyValue: 'book',
    });

    expect(result).toEqual([1, 4]);
    expect(invoke).toHaveBeenCalledWith('get_graph_filter_nodes', {
      workspacePath: 'C:/vault',
      epochLow: 2,
      epochHigh: 3,
      folder: 'Projects',
      tag: null,
      propertyKey: 'type',
      propertyValue: 'book',
    });
  });
});

describe('loadGraphModifiedDateDelta', () => {
  it('loads validated date changes against the captured graph and layout', async () => {
    const delta = {
      baseEpochLow: 2,
      baseEpochHigh: 3,
      revision: 8,
      modifiedNewest: 19_500,
      updates: [{ index: 4, modifiedDay: 19_500 }],
    };
    vi.mocked(invoke).mockResolvedValueOnce(delta);

    await expect(loadGraphModifiedDateDelta('C:/vault', { low: 2, high: 3 }, 7, {
      layoutMode: 'ring', attraction: 1.2, repulsion: 0.8,
    })).resolves.toEqual(delta);
    expect(invoke).toHaveBeenCalledWith('get_graph_modified_date_delta', {
      workspacePath: 'C:/vault',
      baseEpochLow: 2,
      baseEpochHigh: 3,
      sinceRevision: 7,
      layoutMode: 'ring',
      attraction: 1.2,
      repulsion: 0.8,
    });
  });

  it('returns null for absent or out-of-range data', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(null).mockResolvedValueOnce({
      baseEpochLow: 2,
      baseEpochHigh: 3,
      revision: 8,
      modifiedNewest: 19_500,
      updates: [{ index: 0x1_0000_0000, modifiedDay: 19_500 }],
    }).mockResolvedValueOnce({
      baseEpochLow: 2,
      baseEpochHigh: 3,
      revision: 8,
      modifiedNewest: Number.NaN,
      updates: [],
    });

    await expect(loadGraphModifiedDateDelta('C:/vault', { low: 2, high: 3 }, 7)).resolves.toBeNull();
    await expect(loadGraphModifiedDateDelta('C:/vault', { low: 2, high: 3 }, 7)).resolves.toBeNull();
    await expect(loadGraphModifiedDateDelta('C:/vault', { low: 2, high: 3 }, 7)).resolves.toBeNull();
  });

  it('rejects an invalid epoch or revision before calling Tauri', async () => {
    vi.clearAllMocks();
    await expect(loadGraphModifiedDateDelta('C:/vault', { low: -1, high: 3 }, 7)).resolves.toBeNull();
    await expect(loadGraphModifiedDateDelta('C:/vault', { low: 2, high: 3 }, Number.NaN)).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('loadGraphTopologyDelta', () => {
  it('loads a validated topology change for the captured graph revision', async () => {
    const delta = {
      baseEpochLow: 2,
      baseEpochHigh: 3,
      revision: 8,
      edgeSlotCount: 4,
      edgeCount: 3,
      metricsStale: true,
      nodeUpdates: [{ index: 1, degree: 2, modifiedDay: 19_500 }],
      edgeUpdates: [{ slot: 3, source: 1, target: 4, directionMask: 129, typeMask: 2 }],
    };
    vi.mocked(invoke).mockResolvedValueOnce(delta);

    const options = { layoutMode: 'ring' as const, attraction: 1.2, repulsion: 0.8 };
    await expect(loadGraphTopologyDelta('C:/vault', { low: 2, high: 3 }, 7, options)).resolves.toEqual(delta);
    expect(invoke).toHaveBeenCalledWith('get_graph_topology_delta', {
      workspacePath: 'C:/vault', baseEpochLow: 2, baseEpochHigh: 3, sinceRevision: 7,
      ...options,
    });
  });

  it('rejects malformed slots, endpoints, masks, counts, epochs and stale revisions', async () => {
    const valid = {
      baseEpochLow: 2, baseEpochHigh: 3, revision: 8, edgeSlotCount: 4, edgeCount: 3,
      metricsStale: true, nodeUpdates: [{ index: 1, degree: 2, modifiedDay: 19_500 }],
      edgeUpdates: [{ slot: 3, source: 1, target: 4, directionMask: 129, typeMask: 2 }],
    };
    vi.mocked(invoke)
      .mockResolvedValueOnce({ ...valid, edgeUpdates: [{ ...valid.edgeUpdates[0], target: -1 }] })
      .mockResolvedValueOnce({ ...valid, edgeUpdates: [{ ...valid.edgeUpdates[0], typeMask: 0x1_0000_0000 }] })
      .mockResolvedValueOnce({ ...valid, edgeSlotCount: 3 })
      .mockResolvedValueOnce({ ...valid, revision: 7 })
      .mockResolvedValueOnce({ ...valid, nodeUpdates: [{ index: 1, degree: 2, modifiedDay: Number.NaN }] });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(loadGraphTopologyDelta('C:/vault', { low: 2, high: 3 }, 7)).resolves.toBeNull();
    }
  });
});

describe('graph timeline gateway', () => {
  it('loads the retained baseline range and pages events after an event id', async () => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValueOnce({ baselineEvent: 0, baselineAtNs: 12, latestEvent: 9 });
    vi.mocked(invoke).mockResolvedValueOnce([{ eventId: 9, atNs: 21 }]);

    await expect(loadGraphTimelineRange('C:/vault')).resolves.toEqual({
      baselineEvent: 0,
      baselineAtNs: 12,
      latestEvent: 9,
    });
    await expect(loadGraphTimelineEvents('C:/vault', 4, 30)).resolves.toEqual([
      { eventId: 9, atNs: 21 },
    ]);
    expect(invoke).toHaveBeenNthCalledWith(1, 'get_graph_timeline_range', {
      workspacePath: 'C:/vault',
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'get_graph_timeline_events', {
      workspacePath: 'C:/vault',
      afterEvent: 4,
      limit: 30,
    });
  });

  it('decodes historical graph buffers with selected layout options', async () => {
    vi.clearAllMocks();
    vi.mocked(invoke).mockResolvedValueOnce(encode());

    const snapshot = await loadGraphTimelineSnapshot('C:/vault', 42, {
      layoutMode: 'ring',
      attraction: 1.2,
      repulsion: 0.8,
    });

    expect(snapshot.nodeCount).toBe(2);
    expect(invoke).toHaveBeenCalledWith('get_graph_timeline_snapshot', {
      workspacePath: 'C:/vault',
      eventId: 42,
      layoutMode: 'ring',
      attraction: 1.2,
      repulsion: 0.8,
    });
  });

  it('stops paging history after the caller cancels', async () => {
    vi.clearAllMocks();
    const firstPage = Array.from({ length: 500 }, (_, index) => ({ eventId: index + 1, atNs: index + 1 }));
    let resolveSecondPage!: (events: { eventId: number; atNs: number }[]) => void;
    const secondPage = new Promise<{ eventId: number; atNs: number }[]>((resolve) => {
      resolveSecondPage = resolve;
    });
    vi.mocked(invoke).mockResolvedValueOnce(firstPage).mockReturnValueOnce(secondPage);
    let active = true;

    const loading = loadGraphTimelineEventsThrough('C:/vault', 0, 1000, () => active);
    await Promise.resolve();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledTimes(2);
    active = false;
    resolveSecondPage([{ eventId: 1000, atNs: 1000 }]);

    await expect(loading).resolves.toHaveLength(500);
    expect(invoke).toHaveBeenCalledTimes(2);
  });
});

describe('loadGraphClusterIds', () => {
  it('sends snapshot identity and the selected resolution', async () => {
    vi.mocked(invoke).mockResolvedValueOnce([0, 0, 1]);

    const result = await loadGraphClusterIds('C:/vault', { low: 2, high: 3 }, 1.8);

    expect(result).toEqual([0, 0, 1]);
    expect(invoke).toHaveBeenCalledWith('get_graph_cluster_ids', {
      workspacePath: 'C:/vault',
      epochLow: 2,
      epochHigh: 3,
      resolution: 1.8,
    });
  });
});

describe('saveGraphPositions', () => {
  it('persists only the moved node against its graph epoch', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(undefined);

    await saveGraphPositions('C:/vault', { low: 2, high: 3 }, [{ index: 5, x: 1.25, y: -2.5 }]);

    expect(invoke).toHaveBeenCalledWith('set_graph_positions', {
      workspacePath: 'C:/vault',
      epochLow: 2,
      epochHigh: 3,
      updates: [{ index: 5, x: 1.25, y: -2.5 }],
      layoutMode: 'force',
      attraction: 1,
      repulsion: 1,
    });
  });

  it('loads snapshots with the selected layout options', async () => {
    vi.mocked(invoke).mockResolvedValueOnce(encode());

    await loadGraphSnapshot('C:/vault', { layoutMode: 'ring', attraction: 1.4, repulsion: 0.8 });

    expect(invoke).toHaveBeenCalledWith('get_graph_snapshot', {
      workspacePath: 'C:/vault',
      layoutMode: 'ring',
      attraction: 1.4,
      repulsion: 0.8,
    });
  });
});
