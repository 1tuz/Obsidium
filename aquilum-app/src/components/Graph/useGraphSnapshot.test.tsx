// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { loadGraphModifiedDateDelta, loadGraphSnapshot, loadGraphTimelineSnapshot, loadGraphTopologyDelta } from '../../modules/graph';
import type { GraphSnapshot } from '../../modules/graph';
import { useGraphSnapshot } from './useGraphSnapshot';
import type { GraphRenderer } from './renderer';

vi.mock('../../modules/graph', () => ({
  loadGraphSnapshot: vi.fn(),
  loadGraphTimelineSnapshot: vi.fn(),
  loadGraphModifiedDateDelta: vi.fn(),
  loadGraphTopologyDelta: vi.fn(),
}));

const graphSnapshot = (epoch: number, modifiedDay = 1): GraphSnapshot => ({
  nodeCount: 1,
  edgeCount: 0,
  epoch: { low: epoch, high: 0 },
  positions: new Float32Array([0, 0]),
  createdDays: new Float32Array([1]),
  modifiedDays: new Float32Array([modifiedDay]),
  degrees: new Uint32Array([0]),
  nodeIds: new Uint32Array([epoch, 0]),
  clusterIds: new Uint32Array([0]),
  edges: new Uint32Array(),
  edgeDirections: new Uint32Array(),
  edgeTypes: new Uint32Array(),
});

const layoutOptions = { layoutMode: 'force' as const, attraction: 1, repulsion: 1 };
const appliedEpochs: number[] = [];
const appliedDateUpdates: Array<{ index: number; modifiedDay: number }[]> = [];
const appliedDateEpochs: GraphSnapshot['epoch'][] = [];
const appliedTopologyDeltas: Array<unknown> = [];
let rendererSnapshot: GraphSnapshot | null = null;
let topologyApplySucceeds = true;

interface HarnessProps { eventId: number | null; revision?: number; workspacePath?: string; layoutMode?: typeof layoutOptions.layoutMode | 'ring' }

function Harness({ eventId, revision = 3, workspacePath = '/vault', layoutMode = 'force' }: HarnessProps) {
  const options = layoutMode === 'force' ? layoutOptions : { ...layoutOptions, layoutMode };
  const renderer = useRef({
    setSnapshot: vi.fn((snapshot: GraphSnapshot) => {
      rendererSnapshot = snapshot;
      appliedEpochs.push(snapshot.epoch.low);
    }),
    applyModifiedDateUpdates: vi.fn((updates: readonly { index: number; modifiedDay: number }[], epoch: GraphSnapshot['epoch']) => {
      if (!rendererSnapshot
        || rendererSnapshot.epoch.low !== epoch.low
        || rendererSnapshot.epoch.high !== epoch.high
        || updates.some(({ index }) => index < 0 || index >= rendererSnapshot!.nodeCount)) return null;
      appliedDateUpdates.push([...updates]);
      appliedDateEpochs.push(epoch);
      for (const { index, modifiedDay } of updates) rendererSnapshot.modifiedDays[index] = modifiedDay;
      const newest = Math.max(...rendererSnapshot.modifiedDays);
      return { oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: newest };
    }),
    applyTopologyDelta: vi.fn((delta: unknown, epoch: GraphSnapshot['epoch']) => {
      if (!topologyApplySucceeds || !rendererSnapshot
        || rendererSnapshot.epoch.low !== epoch.low || rendererSnapshot.epoch.high !== epoch.high) return false;
      appliedTopologyDeltas.push(delta);
      return true;
    }),
    hasSnapshot: () => true,
    createdRange: () => ({ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: rendererSnapshot?.modifiedDays[0] ?? 1 }),
    fit: vi.fn(),
  } as unknown as GraphRenderer);
  const labels = useRef({ adopt: vi.fn() }).current;
  const result = useGraphSnapshot({
    rendererRef: renderer,
    generation: 1,
    labels: labels as never,
    workspacePath,
    indexRevision: revision,
    attempt: 0,
    reload: 0,
    activated: true,
    inactive: false,
    rendererError: null,
    layoutOptions: options,
    timelineEventId: eventId,
  });
  return (
    <output
      data-epoch={result.snapshot?.epoch.low ?? ''}
      data-loading={result.timelineLoading}
      data-timeline-error={result.timelineError ?? ''}
      data-snapshot-error={result.snapshotError ?? ''}
      data-modified-newest={result.range.modifiedNewest}
      data-metrics-stale={result.metricsStale}
    />
  );
}

describe('useGraphSnapshot timeline', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    appliedEpochs.length = 0;
    appliedDateUpdates.length = 0;
    appliedDateEpochs.length = 0;
    appliedTopologyDeltas.length = 0;
    rendererSnapshot = null;
    topologyApplySucceeds = true;
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('applies a live date delta without replacing the graph snapshot', async () => {
    vi.mocked(loadGraphSnapshot).mockResolvedValue(graphSnapshot(10));
    vi.mocked(loadGraphModifiedDateDelta).mockResolvedValue({
      baseEpochLow: 10, baseEpochHigh: 0, revision: 4, modifiedNewest: 22,
      updates: [{ index: 0, modifiedDay: 22 }],
    });
    act(() => { renderer = mountDom(<Harness eventId={null} revision={3} />); });
    await actAndSettle();

    act(() => renderer!.update(<Harness eventId={null} revision={4} />));
    await actAndSettle();

    expect(loadGraphModifiedDateDelta).toHaveBeenCalledWith('/vault', { low: 10, high: 0 }, 3, layoutOptions);
    expect(appliedDateEpochs).toEqual([{ low: 10, high: 0 }]);
    expect(appliedDateUpdates).toEqual([[{ index: 0, modifiedDay: 22 }]]);
    expect(appliedEpochs).toEqual([10]);
    expect(renderer!.container.querySelector('output')?.dataset.modifiedNewest).toBe('22');
    expect(loadGraphTopologyDelta).not.toHaveBeenCalled();
  });

  it('loads a full snapshot when the date delta is unavailable or has a different epoch', async () => {
    vi.mocked(loadGraphSnapshot).mockResolvedValueOnce(graphSnapshot(10)).mockResolvedValue(graphSnapshot(11));
    vi.mocked(loadGraphModifiedDateDelta)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        baseEpochLow: 99, baseEpochHigh: 0, revision: 5, modifiedNewest: 23, updates: [],
      });
    act(() => { renderer = mountDom(<Harness eventId={null} revision={3} />); });
    await actAndSettle();

    act(() => renderer!.update(<Harness eventId={null} revision={4} />));
    await actAndSettle();
    act(() => renderer!.update(<Harness eventId={null} revision={5} />));
    await actAndSettle();

    expect(loadGraphSnapshot).toHaveBeenCalledTimes(3);
    expect(appliedEpochs).toEqual([10, 11, 11]);
  });

  it('applies topology deltas after a missing date delta and keeps the graph epoch', async () => {
    vi.mocked(loadGraphSnapshot).mockResolvedValue(graphSnapshot(10));
    vi.mocked(loadGraphModifiedDateDelta).mockResolvedValue(null);
    vi.mocked(loadGraphTopologyDelta).mockResolvedValue({
      baseEpochLow: 10,
      baseEpochHigh: 0,
      revision: 4,
      edgeSlotCount: 1,
      edgeCount: 1,
      metricsStale: true,
      nodeUpdates: [{ index: 0, degree: 1 }],
      edgeUpdates: [{ slot: 0, source: 0, target: 1, directionMask: 1, typeMask: 1 }],
    });
    act(() => { renderer = mountDom(<Harness eventId={null} revision={3} />); });
    await actAndSettle();

    act(() => renderer!.update(<Harness eventId={null} revision={4} />));
    await actAndSettle();

    expect(loadGraphTopologyDelta).toHaveBeenCalledWith('/vault', { low: 10, high: 0 }, 3, layoutOptions);
    expect(appliedTopologyDeltas).toHaveLength(1);
    expect(appliedEpochs).toEqual([10]);
    expect(renderer!.container.querySelector('output')?.dataset.epoch).toBe('10');
    expect(renderer!.container.querySelector('output')?.dataset.metricsStale).toBe('true');
  });

  it('falls back to a full snapshot when the renderer rejects a topology delta', async () => {
    vi.mocked(loadGraphSnapshot).mockResolvedValueOnce(graphSnapshot(10)).mockResolvedValueOnce(graphSnapshot(11));
    vi.mocked(loadGraphModifiedDateDelta).mockResolvedValue(null);
    vi.mocked(loadGraphTopologyDelta).mockResolvedValue({
      baseEpochLow: 10,
      baseEpochHigh: 0,
      revision: 4,
      edgeSlotCount: 0,
      edgeCount: 0,
      metricsStale: true,
      nodeUpdates: [],
      edgeUpdates: [],
    });
    act(() => { renderer = mountDom(<Harness eventId={null} revision={3} />); });
    await actAndSettle();
    topologyApplySucceeds = false;

    act(() => renderer!.update(<Harness eventId={null} revision={4} />));
    await actAndSettle();

    expect(loadGraphSnapshot).toHaveBeenCalledTimes(2);
    expect(appliedEpochs).toEqual([10, 11]);
    expect(renderer!.container.querySelector('output')?.dataset.epoch).toBe('11');
    expect(renderer!.container.querySelector('output')?.dataset.metricsStale).toBe('false');
  });

  it('bypasses date deltas when timeline is open and when workspace or layout changes', async () => {
    vi.mocked(loadGraphSnapshot).mockResolvedValue(graphSnapshot(10));
    vi.mocked(loadGraphTimelineSnapshot).mockResolvedValue(graphSnapshot(4));
    act(() => { renderer = mountDom(<Harness eventId={null} />); });
    await actAndSettle();
    act(() => renderer!.update(<Harness eventId={null} revision={4} workspacePath="/other" />));
    await actAndSettle();
    act(() => renderer!.update(<Harness eventId={null} revision={5} layoutMode="ring" />));
    await actAndSettle();
    act(() => renderer!.update(<Harness eventId={4} revision={6} />));
    await actAndSettle();

    expect(loadGraphModifiedDateDelta).not.toHaveBeenCalled();
    expect(loadGraphSnapshot).toHaveBeenCalledTimes(3);
    expect(loadGraphTimelineSnapshot).toHaveBeenCalledTimes(1);
  });

  it('drops stale date results and applies only the latest queued revision', async () => {
    vi.mocked(loadGraphSnapshot).mockResolvedValue(graphSnapshot(10));
    let resolveFirst!: (delta: Awaited<ReturnType<typeof loadGraphModifiedDateDelta>>) => void;
    vi.mocked(loadGraphModifiedDateDelta)
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({
        baseEpochLow: 10, baseEpochHigh: 0, revision: 5, modifiedNewest: 25,
        updates: [{ index: 0, modifiedDay: 25 }],
      });
    act(() => { renderer = mountDom(<Harness eventId={null} revision={3} />); });
    await actAndSettle();
    act(() => renderer!.update(<Harness eventId={null} revision={4} />));
    act(() => renderer!.update(<Harness eventId={null} revision={5} />));

    await act(async () => { resolveFirst({
      baseEpochLow: 10, baseEpochHigh: 0, revision: 4, modifiedNewest: 24,
      updates: [{ index: 0, modifiedDay: 24 }],
    }); });
    await actAndSettle();

    expect(appliedDateUpdates).toEqual([[{ index: 0, modifiedDay: 25 }]]);
    expect(appliedEpochs).toEqual([10]);
    expect(renderer!.container.querySelector('output')?.dataset.modifiedNewest).toBe('25');
  });

  it('loads a historical snapshot and restores a fresh live snapshot when timeline closes', async () => {
    vi.mocked(loadGraphSnapshot).mockResolvedValue(graphSnapshot(10));
    vi.mocked(loadGraphTimelineSnapshot).mockResolvedValue(graphSnapshot(4));
    act(() => { renderer = mountDom(<Harness eventId={null} />); });
    await actAndSettle();
    expect(renderer!.container.querySelector('output')?.dataset.epoch).toBe('10');

    act(() => renderer!.update(<Harness eventId={4} />));
    await actAndSettle();
    expect(loadGraphTimelineSnapshot).toHaveBeenCalledWith('/vault', 4, {
      layoutMode: 'force', attraction: 1, repulsion: 1,
    });
    expect(renderer!.container.querySelector('output')?.dataset.epoch).toBe('4');

    act(() => renderer!.update(<Harness eventId={4} revision={4} />));
    await actAndSettle();
    expect(loadGraphTimelineSnapshot).toHaveBeenCalledTimes(1);

    act(() => renderer!.update(<Harness eventId={null} revision={4} />));
    await actAndSettle();
    expect(loadGraphSnapshot).toHaveBeenCalledTimes(2);
    expect(renderer!.container.querySelector('output')?.dataset.epoch).toBe('10');
  });

  it('keeps historical snapshot errors out of the live graph error state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(loadGraphSnapshot).mockResolvedValue(graphSnapshot(10));
    vi.mocked(loadGraphTimelineSnapshot).mockRejectedValue(new Error('history unavailable'));
    act(() => { renderer = mountDom(<Harness eventId={null} />); });
    await actAndSettle();
    act(() => renderer!.update(<Harness eventId={4} />));
    await actAndSettle();

    const output = renderer!.container.querySelector('output')!;
    expect(output.dataset.loading).toBe('false');
    expect(output.dataset.timelineError).not.toBe('');
    expect(output.dataset.snapshotError).toBe('');
    expect(output.dataset.epoch).toBe('10');
  });

  it('coalesces rapid historical selections behind one in-flight snapshot request', async () => {
    vi.mocked(loadGraphSnapshot).mockResolvedValue(graphSnapshot(10));
    let resolveFirst!: (snapshot: GraphSnapshot) => void;
    const firstSnapshot = new Promise<GraphSnapshot>((resolve) => { resolveFirst = resolve; });
    vi.mocked(loadGraphTimelineSnapshot).mockImplementation((_path, eventId) => (
      eventId === 4 ? firstSnapshot : Promise.resolve(graphSnapshot(eventId))
    ));
    act(() => { renderer = mountDom(<Harness eventId={null} />); });
    await actAndSettle();

    act(() => renderer!.update(<Harness eventId={4} />));
    act(() => renderer!.update(<Harness eventId={5} />));
    act(() => renderer!.update(<Harness eventId={6} />));
    expect(vi.mocked(loadGraphTimelineSnapshot).mock.calls.map(([, eventId]) => eventId))
      .toEqual([4]);

    await act(async () => { resolveFirst(graphSnapshot(4)); });
    await actAndSettle();
    expect(vi.mocked(loadGraphTimelineSnapshot).mock.calls.map(([, eventId]) => eventId))
      .toEqual([4, 6]);
    expect(renderer!.container.querySelector('output')?.dataset.epoch).toBe('6');
    expect(appliedEpochs).toEqual([10, 6]);
  });

  it('reuses an in-flight snapshot when the slider returns to the same event', async () => {
    vi.mocked(loadGraphSnapshot).mockResolvedValue(graphSnapshot(10));
    let resolveSnapshot!: (snapshot: GraphSnapshot) => void;
    const pendingSnapshot = new Promise<GraphSnapshot>((resolve) => { resolveSnapshot = resolve; });
    vi.mocked(loadGraphTimelineSnapshot).mockImplementation((_path, eventId) => (
      eventId === 4 ? pendingSnapshot : Promise.resolve(graphSnapshot(eventId))
    ));
    act(() => { renderer = mountDom(<Harness eventId={null} />); });
    await actAndSettle();

    act(() => renderer!.update(<Harness eventId={4} />));
    act(() => renderer!.update(<Harness eventId={5} />));
    act(() => renderer!.update(<Harness eventId={4} />));
    await act(async () => { resolveSnapshot(graphSnapshot(4)); });
    await actAndSettle();

    expect(vi.mocked(loadGraphTimelineSnapshot).mock.calls.map(([, eventId]) => eventId))
      .toEqual([4]);
    expect(appliedEpochs).toEqual([10, 4]);
  });
});
