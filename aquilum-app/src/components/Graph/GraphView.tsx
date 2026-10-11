import { plural, t } from '../../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GraphNotice, GraphStatus } from './GraphOverlay';
import { GraphSettings } from './GraphSettings';
import { MAX_EDGES_PER_FRAME } from './nodeMetrics';
import { NoteLabels } from './noteLabels';
import { loadGraphPaths, saveGraphPositions } from '../../modules/graph';
import { loadGraphTimelineEventsThrough, loadGraphTimelineRange } from '../../modules/graph';
import type { GraphEpoch } from '../../modules/graph';
import type { GraphLayoutOptions } from '../../modules/graph';
import type { GraphTimelineEvent } from '../../modules/graph';
import type { GraphCameraState } from '../../modules/ui-state';
import { useStableCallback } from '../../hooks/useStableCallback';
import { useGraphControls } from './useGraphControls';
import { useGraphRenderer } from './useGraphRenderer';
import { useGraphSnapshot } from './useGraphSnapshot';
import type { GraphPathState } from './renderer';
import { buildCommunityIndex, clampCommunityPage, collapsedCommunityIds, communityPage as getCommunityPage, communityStableId, type CommunityLabel } from './communitySummary';
import { analyzeDocument, type AnalysisResult } from '../../modules/analysis';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { GraphTimeline } from './GraphTimeline';
import { suggestionNodeIndices, writeSuggestedLink } from './suggestedLinks';
import './GraphView.css';

interface GraphViewProps {
  workspacePath: string | null;
  indexRevision: number;
  inactive: boolean;
  sessionReady: boolean;
  readCamera: () => GraphCameraState | null;
  onCameraChange: (camera: GraphCameraState) => void;
  onOpenNote: (path: string) => void;
}

export function GraphView({
  workspacePath,
  indexRevision,
  inactive,
  sessionReady,
  readCamera,
  onCameraChange,
  onOpenNote,
}: GraphViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraGenerationRef = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [reload, setReload] = useState(0);
  const [activated, setActivated] = useState(!inactive);
  const [pathMode, setPathMode] = useState(false);
  const [pathState, setPathState] = useState<GraphPathState>({ status: 'idle' });
  const [communities, setCommunities] = useState<CommunityLabel[]>([]);
  const [communityPage, setCommunityPage] = useState(0);
  const [selectedGraphNode, setSelectedGraphNode] = useState<number | null>(null);
  const [selectedGraphPath, setSelectedGraphPath] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AnalysisResult[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [pendingLink, setPendingLink] = useState<AnalysisResult | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkPending, setLinkPending] = useState(false);
  const [layoutOptions, setLayoutOptions] = useState<GraphLayoutOptions>({
    layoutMode: 'force',
    attraction: 1,
    repulsion: 1,
  });
  const [timelineEventId, setTimelineEventId] = useState<number | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineEvents, setTimelineEvents] = useState<GraphTimelineEvent[]>([]);
  const [timelineEventsLoading, setTimelineEventsLoading] = useState(false);
  const [timelineEventsError, setTimelineEventsError] = useState<string | null>(null);
  const timelineEventsRef = useRef<GraphTimelineEvent[]>([]);
  const timelineWorkspaceRef = useRef<string | null>(null);
  const timelineBaselineRef = useRef<number | null>(null);
  const layoutOptionsRef = useRef(layoutOptions);
  const graphEpochRef = useRef<GraphEpoch | null>(null);

  useEffect(() => {
    if (!inactive) setActivated(true);
  }, [inactive]);

  useEffect(() => {
    setCommunityPage(0);
  }, [workspacePath]);

  const labelsRef = useRef<NoteLabels | null>(null);
  if (!labelsRef.current) {
    labelsRef.current = new NoteLabels(loadGraphPaths);
  }
  const labels = labelsRef.current;

  useEffect(() => {
    return () => {
      labels.detach();
    };
  }, [labels]);

  const visible = activated && !inactive;
  const generationRef = useRef(0);

  const handleCameraSettled = useStableCallback((camera: GraphCameraState) => {
    cameraGenerationRef.current = generationRef.current;
    onCameraChange(camera);
  });
  const handlePathState = useStableCallback(setPathState);
  const handleGraphNodeSelect = useStableCallback((node: number, path: string) => {
    setSelectedGraphNode(node);
    setSelectedGraphPath(path);
  });
  const handlePositionChange = useStableCallback((node: number, x: number, y: number) => {
    const epoch = graphEpochRef.current;
    if (!workspacePath || !epoch || timelineEventId !== null) return;
    void saveGraphPositions(workspacePath, epoch, [{ index: node, x, y }], layoutOptionsRef.current)
      .catch((error: unknown) => console.error('Failed to save graph node position', error));
  });

  const { rendererRef, generation, rendererError, visibleNodes, attachScaleReadout } = useGraphRenderer({
    canvasRef,
    labels,
    visible,
    attempt,
    onOpenNote,
    onGraphNodeSelect: handleGraphNodeSelect,
    onPositionChange: handlePositionChange,
    onCameraSettled: handleCameraSettled,
    onPathState: handlePathState,
  });

  generationRef.current = generation;

  useEffect(() => {
    rendererRef.current?.setPathMode(pathMode);
  }, [generation, pathMode, rendererRef]);

  const {
    counts,
    range,
    snapshotError,
    snapshot,
    snapshotLoading,
    timelineLoading: snapshotTimelineLoading,
    timelineError: snapshotTimelineError,
    metricsStale,
  } = useGraphSnapshot({
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
    layoutOptions,
    timelineEventId,
  });
  graphEpochRef.current = snapshot?.epoch ?? null;

  const {
    controls,
    patchControls,
    filterStatus,
    presets,
    savePreset,
    applyPreset,
    deletePreset,
    communityData,
  } = useGraphControls(
    rendererRef,
    generation,
    counts,
    range,
    workspacePath,
  );
  const nextLayoutOptions = {
    layoutMode: controls.layoutMode,
    attraction: controls.attraction,
    repulsion: controls.repulsion,
  };
  layoutOptionsRef.current = nextLayoutOptions;
  useEffect(() => {
    setLayoutOptions((current) => (
      current.layoutMode === nextLayoutOptions.layoutMode
      && current.attraction === nextLayoutOptions.attraction
      && current.repulsion === nextLayoutOptions.repulsion
        ? current
        : nextLayoutOptions
    ));
  }, [controls.attraction, controls.layoutMode, controls.repulsion]);

  useEffect(() => {
    if (!timelineOpen || !workspacePath) return;
    let current = true;
    setTimelineEventsLoading(true);
    setTimelineEventsError(null);
    void (async () => {
      try {
        const range = await loadGraphTimelineRange(workspacePath);
        if (!current) return;
        const sameHistory = timelineWorkspaceRef.current === workspacePath
          && timelineBaselineRef.current === range.baselineEvent;
        const events = sameHistory && timelineEventsRef.current.length > 0
          ? [...timelineEventsRef.current]
          : [{ eventId: range.baselineEvent, atNs: range.baselineAtNs }];
        const afterEvent = events[events.length - 1].eventId;
        events.push(...await loadGraphTimelineEventsThrough(
          workspacePath,
          afterEvent,
          range.latestEvent,
          () => current,
        ));
        if (!current) return;
        timelineWorkspaceRef.current = workspacePath;
        timelineBaselineRef.current = range.baselineEvent;
        timelineEventsRef.current = events;
        setTimelineEvents(events);
      } catch (error) {
        if (current) setTimelineEventsError(error instanceof Error ? error.message : String(error));
      } finally {
        if (current) setTimelineEventsLoading(false);
      }
    })();
    return () => {
      current = false;
      setTimelineEventsLoading(false);
    };
  }, [indexRevision, timelineOpen, workspacePath]);

  useEffect(() => {
    timelineWorkspaceRef.current = null;
    timelineBaselineRef.current = null;
    timelineEventsRef.current = [];
    setTimelineEvents([]);
    setTimelineEventId(null);
    setTimelineEventsError(null);
  }, [workspacePath]);

  const communityIndex = useMemo(() => {
    if (metricsStale
      || !snapshot
      || !communityData
      || communityData.ids.length !== snapshot.nodeCount
      || communityData.epoch.low !== snapshot.epoch.low
      || communityData.epoch.high !== snapshot.epoch.high) return null;
    return buildCommunityIndex(
      communityData.ids,
      snapshot.degrees,
      snapshot.nodeIds,
    );
  }, [
    communityData?.ids,
    metricsStale,
    communityData?.epoch.high,
    communityData?.epoch.low,
    snapshot?.degrees,
    snapshot?.epoch.high,
    snapshot?.epoch.low,
    snapshot?.nodeCount,
    snapshot?.nodeIds,
  ]);
  const visibleCommunityPage = clampCommunityPage(communityPage, communityIndex?.total ?? 0);
  const visibleCommunityRepresentatives = useMemo(() => (
    communityIndex ? getCommunityPage(communityIndex, visibleCommunityPage) : []
  ), [communityIndex, visibleCommunityPage]);
  const collapsedCommunityIdsForView = useMemo(() => (
    communityIndex
      ? collapsedCommunityIds(communityIndex, controls.collapsedCommunities)
      : null
  ), [communityIndex, controls.collapsedCommunities]);

  useEffect(() => {
    setCommunityPage(0);
  }, [communityData?.ids, communityData?.epoch.high, communityData?.epoch.low, snapshot?.epoch.high, snapshot?.epoch.low]);

  useEffect(() => {
    setCommunityPage((page) => clampCommunityPage(page, communityIndex?.total ?? 0));
  }, [communityIndex?.total]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!controls.suggestionsEnabled
      || selectedGraphNode === null
      || !selectedGraphPath
      || !snapshot
      || !workspacePath
      || !sessionReady) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      renderer?.setSuggestedEdges(-1, []);
      return;
    }
    let current = true;
    setSuggestions([]);
    setSuggestionsLoading(true);
    renderer?.setSuggestedEdges(selectedGraphNode, []);
    void analyzeDocument(
      workspacePath,
      selectedGraphPath,
      controls.suggestionMethod,
      25,
    ).then(async (results) => {
      const candidates = results.filter((result) => result.path !== selectedGraphPath);
      const indexed = await suggestionNodeIndices(
        snapshot,
        candidates.map((result) => result.path),
        loadGraphPaths,
      );
      if (!current) return;
      const validPaths = new Set(indexed.map(({ path }) => path));
      setSuggestions(candidates.filter((result) => validPaths.has(result.path)));
      rendererRef.current?.setSuggestedEdges(selectedGraphNode, indexed.map(({ node }) => node));
      setSuggestionsLoading(false);
    }).catch((error: unknown) => {
      if (!current) return;
      console.error('Failed to load graph link suggestions', error);
      setSuggestions([]);
      setSuggestionsLoading(false);
    });
    return () => { current = false; };
  }, [
    controls.suggestionMethod,
    controls.suggestionsEnabled,
    generation,
    indexRevision,
    selectedGraphNode,
    selectedGraphPath,
    sessionReady,
    snapshot,
    workspacePath,
  ]);

  const createSuggestedLink = useStableCallback(async () => {
    if (!pendingLink || !selectedGraphPath || !workspacePath) return;
    setLinkPending(true);
    setLinkError(null);
    try {
      await writeSuggestedLink(workspacePath, selectedGraphPath, pendingLink.path);
      setPendingLink(null);
    } catch (error) {
      setLinkError(error instanceof Error ? error.message : String(error));
    } finally {
      setLinkPending(false);
    }
  });

  useEffect(() => {
    if (collapsedCommunityIdsForView) {
      rendererRef.current?.setCollapsedCommunities(collapsedCommunityIdsForView);
    }
  }, [collapsedCommunityIdsForView, generation, rendererRef]);

  useEffect(() => {
    if (visibleCommunityRepresentatives.length === 0) {
      setCommunities([]);
      return;
    }
    let current = true;
    void Promise.all(visibleCommunityRepresentatives.map(async (community) => {
      const note = await labels.resolve(community.node);
      const stableId = communityStableId(snapshot!.nodeIds, community.node);
      return {
        ...community,
        stableId,
        name: controls.communityNames[stableId]
          || note?.title
          || t('graph.communityFallback', { id: community.id + 1 }),
      };
    })).then((next) => {
      if (current) setCommunities(next);
    });
    return () => { current = false; };
  }, [controls.communityNames, labels, snapshot, visibleCommunityRepresentatives]);

  const readStoredCamera = useStableCallback(readCamera);

  useEffect(() => {
    cameraGenerationRef.current = 0;
  }, [workspacePath]);

  useEffect(() => {
    if (cameraGenerationRef.current === generation || !counts || !sessionReady) return;
    const stored = readStoredCamera();
    if (!stored) return;
    cameraGenerationRef.current = generation;
    rendererRef.current?.applyCamera(stored);
  }, [counts, generation, readStoredCamera, rendererRef, sessionReady]);

  const drawnEdges = counts ? Math.min(counts.edgeCount, MAX_EDGES_PER_FRAME) : 0;
  const hasFilters = Boolean(controls.createdShare > 0
    || controls.modifiedShare > 0
    || controls.createdBeforeShare < 1
    || controls.modifiedBeforeShare < 1
    || controls.folderFilter.trim()
    || controls.tagFilter.trim()
    || controls.propertyKeyFilter.trim());
  const status = !counts
    ? t('graph.loading')
    : visibleNodes < counts.nodeCount
      ? t('graph.notesVisible', { visible: visibleNodes, total: counts.nodeCount })
      : plural('graph.notes', counts.nodeCount);

  const failure = rendererError ?? snapshotError;
  const blocked = !workspacePath || failure !== null;

  return (
    <div className={inactive ? 'q-graph q-graph--hidden' : 'q-graph'}>
      {visible && <canvas className="q-graph-canvas" key={attempt} ref={canvasRef} />}
      {!blocked && (
        <GraphStatus
          status={status}
          edgeCount={counts?.edgeCount ?? null}
          drawnEdges={drawnEdges}
          metricsStale={metricsStale}
          onScaleReadout={attachScaleReadout}
        />
      )}
      {!blocked && hasFilters && visibleNodes === 0 && (
        <GraphNotice
          title={t('graph.filteredOut')}
          actionLabel={t('graph.showAll')}
          onAction={() => patchControls({
            createdShare: 0,
            modifiedShare: 0,
            createdBeforeShare: 1,
            modifiedBeforeShare: 1,
            folderFilter: '',
            tagFilter: '',
            propertyKeyFilter: '',
            propertyValueFilter: '',
          })}
        />
      )}
      {!blocked && (
        <GraphTimeline
          events={timelineEvents}
          selectedEventId={timelineEventId}
          loading={timelineEventsLoading}
          snapshotLoading={snapshotLoading || snapshotTimelineLoading}
          error={timelineEventsError ?? snapshotTimelineError}
          onSelect={setTimelineEventId}
          onOpenChange={setTimelineOpen}
        />
      )}
      {blocked && (
        <GraphNotice
          title={workspacePath ? t('graph.notBuilt') : t('graph.noWorkspace')}
          description={failure ?? undefined}
          actionLabel={workspacePath ? t('graph.retry') : undefined}
          onAction={
            workspacePath ? () => setAttempt((current) => current + 1) : undefined
          }
        />
      )}
      {!blocked && (
        <GraphSettings
          controls={controls}
          range={range}
          onChange={patchControls}
          onRefresh={() => setReload((value) => value + 1)}
          presets={presets}
          onSavePreset={savePreset}
          onApplyPreset={applyPreset}
          onDeletePreset={deletePreset}
          pathMode={pathMode}
          pathState={pathState}
          onPathModeChange={setPathMode}
          onClearPath={() => {
            rendererRef.current?.clearPath();
            setPathMode(false);
          }}
          filterStatus={filterStatus}
          communities={communities}
          communityCount={communityIndex?.total ?? 0}
          communityPage={visibleCommunityPage}
          onCommunityPageChange={setCommunityPage}
          suggestions={suggestions}
          suggestionsLoading={suggestionsLoading}
          onCreateSuggestedLink={(suggestion) => {
            setLinkError(null);
            setPendingLink(suggestion);
          }}
        />
      )}
      <ConfirmDialog
        open={pendingLink !== null}
        title={t('graph.confirmSuggestedLinkTitle')}
        description={pendingLink
          ? t('graph.confirmSuggestedLinkDescription', { title: pendingLink.title })
          : ''}
        error={linkError ?? undefined}
        confirmLabel={t('graph.createSuggestedLink')}
        pending={linkPending}
        pendingLabel={t('graph.createSuggestedLinkPending')}
        onCancel={() => setPendingLink(null)}
        onConfirm={() => { void createSuggestedLink(); }}
      />
    </div>
  );
}
