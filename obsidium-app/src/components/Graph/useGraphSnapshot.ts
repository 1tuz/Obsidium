import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  loadGraphModifiedDateDelta,
  loadGraphSnapshot,
  loadGraphTimelineSnapshot,
  type GraphModifiedDateDelta,
  loadGraphTopologyDelta,
  type GraphTopologyDelta,
  type GraphLayoutOptions,
  type GraphSnapshot,
} from '../../modules/graph';
import type { GraphDateRange, GraphRenderer } from './renderer';
import type { NoteLabels } from './noteLabels';
import { readGraphFailure } from './readGraphFailure';

const DEFAULT_LAYOUT_OPTIONS: GraphLayoutOptions = {
  layoutMode: 'force',
  attraction: 1,
  repulsion: 1,
};

export interface GraphCounts {
  nodeCount: number;
  edgeCount: number;
  epoch: GraphSnapshot['epoch'];
}

interface GraphSnapshotInput {
  rendererRef: RefObject<GraphRenderer | null>;
  generation: number;
  labels: NoteLabels;
  workspacePath: string | null;
  indexRevision: number;
  attempt: number;
  reload: number;
  activated: boolean;
  inactive: boolean;
  rendererError: string | null;
  layoutOptions?: GraphLayoutOptions;
  timelineEventId?: number | null;
}

interface SnapshotRequest {
  key: string;
  load: () => Promise<SnapshotRequestResult>;
  apply: (result: SnapshotRequestResult) => Promise<void>;
  fail: (cause: unknown) => void;
  finish: () => void;
}

type SnapshotRequestResult =
  | { kind: 'snapshot'; snapshot: GraphSnapshot; revision: number }
  | {
    kind: 'modifiedDates';
    delta: GraphModifiedDateDelta;
    baseSnapshot: GraphSnapshot;
    baseRevision: number;
  }
  | {
    kind: 'topology';
    delta: GraphTopologyDelta;
    baseSnapshot: GraphSnapshot;
    baseRevision: number;
  };

interface AppliedSnapshot {
  workspacePath: string;
  layoutMode: GraphLayoutOptions['layoutMode'];
  attraction: number;
  repulsion: number;
  attempt: number;
  reload: number;
  live: boolean;
  revision: number;
}

interface SnapshotRequestQueue {
  running: boolean;
  activeKey: string | null;
  pending: SnapshotRequest | null;
}

export function useGraphSnapshot({
  rendererRef,
  generation,
  labels,
  workspacePath,
  indexRevision,
  attempt,
  reload,
  activated,
  inactive,
  rendererError,
  layoutOptions = DEFAULT_LAYOUT_OPTIONS,
  timelineEventId = null,
}: GraphSnapshotInput) {
  const [counts, setCounts] = useState<GraphCounts | null>(null);
  const [range, setRange] = useState<GraphDateRange>({
    oldest: 0,
    newest: 1,
    modifiedOldest: 0,
    modifiedNewest: 1,
  });
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [metricsStale, setMetricsStale] = useState(false);
  const snapshotRef = useRef<GraphSnapshot | null>(null);
  const appliedSnapshotRef = useRef<AppliedSnapshot | null>(null);
  const loadedKeyRef = useRef<string | null>(null);
  const loadedWorkspaceRef = useRef<string | null>(null);
  const shownRef = useRef(false);
  const refittedRef = useRef(0);
  const requestQueueRef = useRef<SnapshotRequestQueue>({ running: false, activeKey: null, pending: null });
  const latestRequestKeyRef = useRef<string | null>(null);
  const snapshotRevision = timelineEventId === null ? indexRevision : `event-${timelineEventId}`;
  const requestEnabled = activated && !inactive && workspacePath !== null && rendererError === null;
  const snapshotKey = requestEnabled
    ? `${attempt} ${reload} ${workspacePath} ${snapshotRevision} ${layoutOptions.layoutMode} ${layoutOptions.attraction} ${layoutOptions.repulsion}`
    : null;
  latestRequestKeyRef.current = snapshotKey;

  useEffect(() => {
    if (!snapshotKey || !workspacePath) return;
    const queue = requestQueueRef.current;
    if (queue.activeKey === snapshotKey) {
      loadedKeyRef.current = snapshotKey;
      queue.pending = null;
      return;
    }
    if (loadedKeyRef.current === snapshotKey) return;
    loadedKeyRef.current = snapshotKey;
    const keepCamera = loadedWorkspaceRef.current === workspacePath;
    if (!keepCamera) shownRef.current = false;
    loadedWorkspaceRef.current = workspacePath;
    const refits = reload !== refittedRef.current;
    refittedRef.current = reload;
    const historical = timelineEventId !== null;
    const historicalEventId = timelineEventId;
    setTimelineLoading(historical);
    setSnapshotLoading(true);
    setTimelineError(null);
    if (!historical) setSnapshotError(null);
    const request: SnapshotRequest = {
      key: snapshotKey,
      load: async () => {
        const fullSnapshot = async (): Promise<SnapshotRequestResult> => ({
          kind: 'snapshot',
          snapshot: historicalEventId !== null
            ? await loadGraphTimelineSnapshot(workspacePath, historicalEventId, layoutOptions)
            : await loadGraphSnapshot(workspacePath, layoutOptions),
          revision: indexRevision,
        });
        if (historicalEventId !== null) return fullSnapshot();
        const baseSnapshot = snapshotRef.current;
        const applied = appliedSnapshotRef.current;
        if (!baseSnapshot || !applied
          || applied.workspacePath !== workspacePath
          || applied.layoutMode !== layoutOptions.layoutMode
          || applied.attraction !== layoutOptions.attraction
          || applied.repulsion !== layoutOptions.repulsion
          || applied.attempt !== attempt
          || applied.reload !== reload
          || !applied.live
          || applied.revision >= indexRevision) return fullSnapshot();
        let delta: GraphModifiedDateDelta | null;
        try {
          delta = await loadGraphModifiedDateDelta(
            workspacePath,
            baseSnapshot.epoch,
            applied.revision,
            layoutOptions,
          );
        } catch {
          return fullSnapshot();
        }
        if (delta && delta.baseEpochLow === baseSnapshot.epoch.low
          && delta.baseEpochHigh === baseSnapshot.epoch.high) {
          return { kind: 'modifiedDates', delta, baseSnapshot, baseRevision: applied.revision };
        }
        let topologyDelta: GraphTopologyDelta | null;
        try {
          topologyDelta = await loadGraphTopologyDelta(
            workspacePath,
            baseSnapshot.epoch,
            applied.revision,
            layoutOptions,
          );
        } catch {
          return fullSnapshot();
        }
        if (!topologyDelta || topologyDelta.baseEpochLow !== baseSnapshot.epoch.low
          || topologyDelta.baseEpochHigh !== baseSnapshot.epoch.high) return fullSnapshot();
        return { kind: 'topology', delta: topologyDelta, baseSnapshot, baseRevision: applied.revision };
      },
      apply: async (result) => {
        const applySnapshot = (snapshot: GraphSnapshot, revision: number) => {
          appliedSnapshotRef.current = {
            workspacePath,
            layoutMode: layoutOptions.layoutMode,
            attraction: layoutOptions.attraction,
            repulsion: layoutOptions.repulsion,
            attempt,
            reload,
            live: historicalEventId === null,
            revision,
          };
          snapshotRef.current = snapshot;
          setMetricsStale(false);
          setSnapshot(snapshot);
          labels.adopt(snapshot.epoch);
          const renderer = rendererRef.current;
          renderer?.setSnapshot(snapshot, keepCamera);
          setRange(renderer?.createdRange() ?? {
            oldest: 0,
            newest: 1,
            modifiedOldest: 0,
            modifiedNewest: 1,
          });
          setCounts({ nodeCount: snapshot.nodeCount, edgeCount: snapshot.edgeCount, epoch: snapshot.epoch });
          setTimelineError(null);
          shownRef.current = true;
          if (refits) renderer?.fit();
        };
        if (result.kind === 'snapshot') {
          applySnapshot(result.snapshot, result.revision);
          return;
        }
        const current = snapshotRef.current;
        const applied = appliedSnapshotRef.current;
        if (current !== result.baseSnapshot || !applied || applied.revision !== result.baseRevision
          || current.epoch.low !== result.delta.baseEpochLow
          || current.epoch.high !== result.delta.baseEpochHigh) {
          const fallback = await loadGraphSnapshot(workspacePath, layoutOptions);
          if (latestRequestKeyRef.current === snapshotKey) applySnapshot(fallback, indexRevision);
          return;
        }
        if (result.kind === 'topology') {
          const renderer = rendererRef.current;
          if (!renderer?.applyTopologyDelta(result.delta, result.baseSnapshot.epoch, result.baseRevision)) {
            const fallback = await loadGraphSnapshot(workspacePath, layoutOptions);
            if (latestRequestKeyRef.current === snapshotKey) applySnapshot(fallback, indexRevision);
            return;
          }
          applied.revision = result.delta.revision;
          setMetricsStale(result.delta.metricsStale);
          setCounts({
            nodeCount: result.baseSnapshot.nodeCount,
            edgeCount: result.delta.edgeCount,
            epoch: result.baseSnapshot.epoch,
          });
          setRange(renderer.createdRange());
          setTimelineError(null);
          shownRef.current = true;
          return;
        }
        const renderer = rendererRef.current;
        const nextRange = renderer?.applyModifiedDateUpdates(result.delta.updates, result.baseSnapshot.epoch) ?? null;
        if (!nextRange && result.delta.updates.length > 0) {
          const fallback = await loadGraphSnapshot(workspacePath, layoutOptions);
          if (latestRequestKeyRef.current === snapshotKey) applySnapshot(fallback, indexRevision);
          return;
        }
        applied.revision = result.delta.revision;
        setRange((currentRange) => ({
          ...(nextRange ?? currentRange),
          modifiedNewest: result.delta.modifiedNewest,
        }));
        setTimelineError(null);
        shownRef.current = true;
      },
      fail: (cause) => {
        loadedKeyRef.current = null;
        console.error('Failed to load the graph snapshot', cause);
        if (historical) {
          setTimelineError(readGraphFailure(cause));
          return;
        }
        if (shownRef.current) return;
        setCounts(null);
        setSnapshotError(readGraphFailure(cause));
      },
      finish: () => {
        setSnapshotLoading(false);
        setTimelineLoading(false);
      },
    };
    queue.pending = request;
    if (!queue.running) {
      queue.running = true;
      void (async () => {
        while (queue.pending) {
          const next = queue.pending;
          queue.pending = null;
          queue.activeKey = next.key;
          try {
            const result = await next.load();
            if (next.key === latestRequestKeyRef.current) await next.apply(result);
          } catch (cause) {
            if (next.key === latestRequestKeyRef.current) next.fail(cause);
          } finally {
            if (next.key === latestRequestKeyRef.current) next.finish();
            queue.activeKey = null;
          }
        }
        queue.running = false;
      })();
    }
    return () => {
      if (queue.pending === request) queue.pending = null;
      if (latestRequestKeyRef.current !== request.key
        && !queue.pending
        && queue.activeKey !== latestRequestKeyRef.current) {
        setSnapshotLoading(false);
        setTimelineLoading(false);
      }
    };
  }, [
    layoutOptions,
    labels,
    rendererRef,
    snapshotKey,
    snapshotRevision,
    timelineEventId,
    workspacePath,
  ]);

  useEffect(() => {
    const renderer = rendererRef.current;
    const snapshot = snapshotRef.current;
    if (!renderer || !snapshot || renderer.hasSnapshot()) return;
    renderer.setSnapshot(snapshot);
  }, [generation, rendererRef]);

  return { counts, range, snapshotError, snapshot, snapshotLoading, timelineLoading, timelineError, metricsStale };
}
