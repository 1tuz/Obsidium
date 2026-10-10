import type { GraphSnapshot } from '../../modules/graph';
import type { GraphTopologyDelta } from '../../modules/graph';
import type { GraphCameraState } from '../../modules/ui-state';
import { motionEnabled } from '../../modules/theme';
import { Camera } from './camera';
import { CanvasSizer } from './canvasSize';
import { shortestPath } from './adjacency';
import { localGraphMask } from './localGraph';
import { DateFilter } from './dateFilter';
import { FrameClock, type FrameStep } from './frameClock';
import { DEFAULT_DISPLAY, type GraphDisplay, type GraphGroupRule } from './graphDisplay';
import { GpuScene } from './gpuScene';
import { HighlightMap } from './highlightMap';
import { LabelLayer, type LabelTypography } from './labelLayer';
import type { NoteLabels } from './noteLabels';
import { dimmedBy, MAX_EDGES_PER_FRAME } from './nodeMetrics';
import { groupRuleColors } from './customGroupIds';
import { observePaletteChanges, readPalette, type Palette } from './palette';
import { pickNode } from './pickGrid';
import { PointerInteraction } from './pointerInteraction';
import { ScaleReadout } from './scaleReadout';
import { SnapshotStore, type GraphDateRange } from './snapshotStore';

export type { GraphDateRange } from './snapshotStore';

const CAMERA_SETTLE_MS = 400;

export type GraphPathState =
  | { status: 'idle' | 'selectStart' | 'selectEnd' | 'missing' }
  | { status: 'found'; nodeCount: number };

export class GraphRenderer {
  private readonly scene: GpuScene;
  private readonly store = new SnapshotStore();
  private readonly highlight = new HighlightMap();
  private readonly filter = new DateFilter();
  private readonly camera = new Camera();
  private readonly labelLayer: LabelLayer;
  private readonly readout = new ScaleReadout();
  private readonly clock = new FrameClock();
  private readonly sizer: CanvasSizer;
  private readonly interaction: PointerInteraction;
  private readonly themeWatcher: MutationObserver;
  private readonly motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  private readonly handleMotionChange = () => this.finishMotionIfDisabled();
  private readonly handleContextLost: (event: Event) => void;
  private palette: Palette;
  private display: GraphDisplay = DEFAULT_DISPLAY;
  private labelsAnimating = false;
  private highlightAnimating = false;
  private visibleNodes = 0;
  private metricsStale = false;
  private ratio = 1;
  private cssWidth = 1;
  private cssHeight = 1;
  private cameraSaveTimer = 0;
  private pathMode = false;
  private pathStart = -1;
  private pathNodes: number[] | null = null;
  private includedNodes: Uint8Array | null = null;
  private metadataNodes: Uint8Array | null = null;
  private collapsedCommunities: number[] = [];
  private customGroupIds = new Uint32Array();
  private customGroupRules: GraphGroupRule[] = [];
  private focusedNode = -1;
  private suggestedSource = -1;
  private suggestedTargets: number[] = [];
  private suggestedEdgeCount = 0;
  private lastDraggedNode = -1;

  onSelect: ((node: number) => void) | null = null;
  onPositionChange: ((node: number, x: number, y: number) => void) | null = null;
  onCameraSettled: ((camera: GraphCameraState) => void) | null = null;
  onVisibleNodes: ((count: number) => void) | null = null;
  onContextLost: (() => void) | null = null;
  onPathState: ((state: GraphPathState) => void) | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    labels: NoteLabels,
  ) {
    this.scene = new GpuScene(canvas);
    this.palette = readPalette(canvas);
    this.labelLayer = new LabelLayer(this.scene.labels, labels);
    this.sizer = new CanvasSizer(canvas, () => this.resize());
    this.interaction = new PointerInteraction(canvas, {
      viewportWidth: () => this.cssWidth,
      viewportHeight: () => this.cssHeight,
      panBy: (dx, dy) => {
        this.camera.panBy(dx, dy);
        this.markCameraMoved();
      },
      panToBy: (dx, dy) => {
        this.camera.panToBy(dx, dy);
        this.markCameraMoved();
      },
      moveNode: (node, centeredX, centeredY) => {
        if (this.store.isMorphing()) return;
        const world = this.camera.toWorld(centeredX, centeredY);
        this.store.moveNode(node, world.x / this.display.spread, world.y / this.display.spread);
        this.lastDraggedNode = node;
      },
      finishNodeDrag: () => {
        const node = this.lastDraggedNode;
        this.lastDraggedNode = -1;
        if (!this.store.finishPositionEdit()) return;
        const snapshot = this.store.snapshot;
        if (snapshot && node >= 0) {
          this.onPositionChange?.(node, snapshot.positions[node * 2], snapshot.positions[node * 2 + 1]);
        }
        this.invalidate();
      },
      zoomBy: (factor, centeredX, centeredY) => {
        this.camera.zoomBy(factor, centeredX, centeredY);
        this.markCameraMoved();
      },
      nodeAt: (centeredX, centeredY) => this.nodeAt(centeredX, centeredY),
      hoverSettled: () => !this.store.isMorphing(),
      hoverChanged: () => this.relight(),
      selected: (node) => this.selectNode(node),
      reset: () => this.fit(),
      invalidate: () => this.invalidate(),
    });
    this.handleContextLost = (event) => {
      event.preventDefault();
      this.clock.stop();
      this.onContextLost?.();
    };
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.themeWatcher = observePaletteChanges(document.documentElement, () => this.refreshPalette());
    this.motionQuery.addEventListener('change', this.handleMotionChange);
    document.documentElement.addEventListener('aquilum-motion-change', this.handleMotionChange);
  }

  setSnapshot(snapshot: GraphSnapshot, keepCamera = false): void {
    if (motionEnabled() && (this.store.isMorphing() || this.store.hasGhosts)) {
      this.store.queueSnapshot(snapshot, keepCamera);
      return;
    }
    this.store.clearQueuedSnapshot();
    this.adoptSnapshot(snapshot, keepCamera);
  }

  private adoptSnapshot(snapshot: GraphSnapshot, keepCamera: boolean): void {
    const settled = this.store.snapshot !== null;
    this.metricsStale = false;
    const morphs = this.store.morphsInto(snapshot, keepCamera);
    this.store.adopt(snapshot, morphs, this.display.edgeType, this.display.edgeDirection);
    this.focusedNode = -1;
    this.suggestedSource = -1;
    this.suggestedTargets = [];
    this.includedNodes = null;
    this.metadataNodes = null;
    this.collapsedCommunities = [];
    this.pathStart = -1;
    this.pathNodes = null;
    this.onPathState?.({ status: this.pathMode ? 'selectStart' : 'idle' });
    this.highlight.resize(this.store.rows);
    this.interaction.forget();
    this.labelLayer.forget();
    this.scene.textures.uploadNodes(this.store.texels, this.store.rows);
    this.customGroupIds = new Uint32Array(snapshot.nodeCount);
    this.customGroupRules = [];
    this.uploadClusterTexture();
    this.scene.textures.uploadFreshness(this.store.freshnessTexture(), this.store.rows);
    this.scene.textures.allocateHighlight(this.highlight.data, this.store.rows);
    this.filter.adopt(
      snapshot.createdDays,
      snapshot.nodeCount,
      this.store.rows,
      this.display.createdFrom,
      this.store.enteringNodes,
      this.store.renderNodeCount - snapshot.nodeCount,
      snapshot.modifiedDays,
      this.display.modifiedFrom,
      null,
      this.display.createdTo,
      this.display.modifiedTo,
    );
    this.scene.textures.allocateReveal(this.filter.data, this.store.rows);
    this.uploadEdges();
    this.refreshSuggestedEdges();
    this.reportVisible();
    if (keepCamera && settled) this.invalidate();
    else this.jumpToFit();
  }

  createdRange() {
    return this.store.createdRange();
  }

  applyModifiedDateUpdates(
    updates: readonly { index: number; modifiedDay: number }[],
    expectedEpoch: GraphSnapshot['epoch'],
  ): GraphDateRange | null {
    const snapshot = this.store.snapshot;
    if (!snapshot || snapshot.epoch.low !== expectedEpoch.low || snapshot.epoch.high !== expectedEpoch.high) {
      return null;
    }
    if (!this.store.applyModifiedDateUpdates(updates)) return null;
    for (const { index, modifiedDay } of updates) {
      this.scene.textures.uploadFreshnessNode(snapshot.modifiedDays, index);
      this.filter.setNodeShown(
        index,
        !(snapshot.createdDays[index] < this.display.createdFrom
          || snapshot.createdDays[index] > this.display.createdTo
          || modifiedDay < this.display.modifiedFrom
          || modifiedDay > this.display.modifiedTo)
          && (this.includedNodes === null || this.includedNodes[index] === 1),
      );
    }
    this.reportVisible();
    this.invalidate();
    return this.store.createdRange();
  }

  applyTopologyDelta(
    delta: GraphTopologyDelta,
    expectedEpoch: GraphSnapshot['epoch'],
    sinceRevision: number,
  ): boolean {
    const snapshot = this.store.snapshot;
    const oldEdgeSlotCount = snapshot?.edgeSlotCount ?? snapshot?.edgeCount ?? 0;
    const edgeUpdates = Array.isArray(delta.edgeUpdates) ? delta.edgeUpdates : [];
    const endpointsAreStable = edgeUpdates.length > 0
      && edgeUpdates.every((update) => update?.slot < oldEdgeSlotCount && update?.typeMask !== 0)
      && this.display.edgeType === 'all'
      && this.display.edgeDirection === 'all'
      && this.collapsedCommunities.length === 0;
    const metricsBecameStale = delta.metricsStale && !this.metricsStale;
    if (!snapshot || snapshot.epoch.low !== expectedEpoch.low || snapshot.epoch.high !== expectedEpoch.high
      || delta.baseEpochLow !== expectedEpoch.low || delta.baseEpochHigh !== expectedEpoch.high
      || !this.store.applyTopologyDelta(delta, sinceRevision)) return false;
    for (const { index, modifiedDay } of delta.nodeUpdates) {
      this.scene.textures.uploadNode(this.store.texels, index);
      if (modifiedDay !== undefined) {
        this.scene.textures.uploadFreshnessNode(snapshot.modifiedDays, index);
        this.filter.setNodeShown(
          index,
          !(snapshot.createdDays[index] < this.display.createdFrom
            || snapshot.createdDays[index] > this.display.createdTo
            || modifiedDay < this.display.modifiedFrom
            || modifiedDay > this.display.modifiedTo)
            && (this.includedNodes === null || this.includedNodes[index] === 1),
        );
      }
    }
    if (metricsBecameStale) {
      this.metricsStale = true;
      this.collapsedCommunities = [];
      this.store.setCollapsedCommunities([], null);
      this.updateIncludedNodes();
      this.refilter();
    }
    if (metricsBecameStale) this.uploadClusterTexture();
    if (delta.edgeUpdates.length > 0) {
      if (this.store.sparseEdgeUpdate) {
        this.scene.uploadEdgeUpdates(this.store.renderEdges, this.store.changedRenderEdgeIndices);
        this.scene.uploadArrowUpdates(this.store.renderArrowEdges, this.store.changedRenderArrowIndices);
      } else if (endpointsAreStable) this.uploadGraphArrows();
      else this.uploadGraphEdges();
    }
    this.refreshSuggestedEdges();
    this.reportVisible();
    this.relight();
    this.invalidate();
    return true;
  }

  setCommunityIds(ids: Uint32Array): void {
    const snapshot = this.store.snapshot;
    if (this.metricsStale || !snapshot || ids.length !== snapshot.nodeCount) return;
    snapshot.clusterIds.set(ids);
    if (this.collapsedCommunities.length > 0) {
      this.collapsedCommunities = [];
      this.updateIncludedNodes();
      this.refilter();
    }
    this.uploadClusterTexture();
    this.invalidate();
  }

  setCustomGroupIds(ids: Uint32Array): void {
    const snapshot = this.store.snapshot;
    if (!snapshot || ids.length !== snapshot.nodeCount) return;
    this.customGroupIds = ids;
    this.uploadClusterTexture();
    this.invalidate();
  }

  setCustomGroupRules(rules: GraphGroupRule[]): void {
    this.customGroupRules = rules;
    this.uploadCustomGroupColors();
    this.invalidate();
  }

  setCollapsedCommunities(communities: number[]): void {
    this.collapsedCommunities = this.metricsStale ? [] : communities;
    this.updateIncludedNodes();
    this.refilter();
    this.refreshSuggestedEdges();
    this.invalidate();
  }

  setSuggestedEdges(source: number, targets: number[]): void {
    this.suggestedSource = source;
    this.suggestedTargets = targets;
    this.refreshSuggestedEdges();
    this.invalidate();
  }

  applyDisplay(next: GraphDisplay): void {
    const current = this.display;
    if (matches(current, next)) return;
    this.display = next;
    if (next.spread !== current.spread) this.camera.rescaleWorld(next.spread / current.spread);
    if (next.edgeType !== current.edgeType) {
      this.store.setEdgeType(next.edgeType);
      this.updateIncludedNodes();
    }
    if (next.edgeDirection !== current.edgeDirection) {
      this.store.setEdgeDirection(next.edgeDirection, this.focusedNode);
    }
    if (next.edgeType !== current.edgeType || next.edgeDirection !== current.edgeDirection) {
      if (next.edgeType !== current.edgeType && this.store.snapshot) {
        this.uploadClusterTexture();
      }
      this.uploadEdges();
      if (this.pathNodes && this.pathNodes.length > 1 && this.pathStart < 0) {
        const path = this.store.adjacency
          ? shortestPath(
            this.store.adjacency,
            this.pathNodes[0],
            this.pathNodes[this.pathNodes.length - 1],
            (node) =>
            this.isNodeIncluded(node))
          : null;
        this.pathNodes = path ?? [];
        this.onPathState?.(path
          ? { status: 'found', nodeCount: path.length }
          : { status: 'missing' });
      }
      this.relight();
    }
    if (next.labelDensity !== current.labelDensity) this.labelLayer.setDensity(next.labelDensity);
    if (next.createdFrom !== current.createdFrom || next.createdTo !== current.createdTo
      || next.modifiedFrom !== current.modifiedFrom || next.modifiedTo !== current.modifiedTo) {
      if (this.collapsedCommunities.length > 0) this.updateIncludedNodes();
      this.refilter();
    }
    if (next.highlightDepth !== current.highlightDepth) this.relight();
    if (next.localGraphDepth !== current.localGraphDepth) {
      this.updateIncludedNodes();
      this.refilter();
    }
    if (current.labels && !next.labels) this.labelLayer.clear();
    this.invalidate();
  }

  setScaleReadout(element: HTMLElement | null): void {
    this.readout.attach(element);
    this.readout.paint(this.camera.scale, this.clock.time, false);
  }

  redraw(): void {
    this.invalidate();
  }

  fit(): void {
    if (!this.store.snapshot) return;
    this.camera.glideTo(this.store.bounds(this.display.spread), this.cssWidth, this.cssHeight);
    this.markCameraMoved();
    this.invalidate();
  }

  cameraState(): GraphCameraState {
    return {
      centerX: this.camera.centerX / this.display.spread,
      centerY: this.camera.centerY / this.display.spread,
      scale: this.camera.scale,
    };
  }

  applyCamera(camera: GraphCameraState): void {
    this.camera.moveTo(
      camera.centerX * this.display.spread,
      camera.centerY * this.display.spread,
      camera.scale,
    );
    this.invalidate();
  }

  setPathMode(enabled: boolean): void {
    if (this.pathMode === enabled) return;
    this.pathMode = enabled;
    if (enabled) {
      this.pathStart = -1;
      this.pathNodes = [];
      this.onPathState?.({ status: 'selectStart' });
    } else if (this.pathStart >= 0 || this.pathNodes?.length === 0) {
      this.pathStart = -1;
      this.pathNodes = null;
      this.onPathState?.({ status: 'idle' });
    }
    this.relight();
  }

  setIncludedNodes(indices: number[] | null): void {
    const snapshot = this.store.snapshot;
    if (!snapshot) return;
    this.metadataNodes = indices === null ? null : new Uint8Array(snapshot.nodeCount);
    indices?.forEach((node) => {
      if (Number.isInteger(node) && node >= 0 && node < snapshot.nodeCount) {
        this.metadataNodes![node] = 1;
      }
    });
    this.updateIncludedNodes();
    this.refilter();
    this.invalidate();
  }

  private updateIncludedNodes(): void {
    const snapshot = this.store.snapshot;
    if (!snapshot) return;
    const hadProjection = this.store.collapsedNodeMask !== null;
    const collapsed = this.collapsedCommunities.length > 0;
    if (hadProjection && !collapsed) {
      this.store.setCollapsedCommunities([], null);
      this.refreshProjectedGraph();
    }
    const eligible = collapsed ? new Uint8Array(snapshot.nodeCount) : null;
    for (let node = 0; node < snapshot.nodeCount; node += 1) {
      const dateVisible = !(snapshot.createdDays[node] < this.display.createdFrom
        || snapshot.createdDays[node] > this.display.createdTo
        || snapshot.modifiedDays[node] < this.display.modifiedFrom
        || snapshot.modifiedDays[node] > this.display.modifiedTo);
      if (eligible) {
        eligible[node] = dateVisible && (this.metadataNodes === null || this.metadataNodes[node] === 1) ? 1 : 0;
      }
    }
    const representativeCandidates = eligible?.slice() ?? null;
    let collapsedChanged = collapsed
      ? this.store.setCollapsedCommunities(this.collapsedCommunities, eligible, representativeCandidates)
      : false;
    this.focusedNode = this.store.representative(this.focusedNode);
    const traversalAllowed = eligible ?? this.metadataNodes;
    const local = this.display.localGraphDepth > 0 && this.focusedNode >= 0 && this.store.adjacency
      ? localGraphMask(
        this.store.adjacency,
        this.focusedNode,
        this.display.localGraphDepth,
        traversalAllowed,
      )
      : null;
    if (eligible && local) {
      for (let node = 0; node < snapshot.nodeCount; node += 1) {
        if (local[this.store.representative(node)] !== 1) eligible[node] = 0;
      }
    }
    if (collapsed && eligible) {
      collapsedChanged = this.store.setCollapsedCommunities(
        this.collapsedCommunities,
        eligible,
        representativeCandidates,
      ) || collapsedChanged;
      this.focusedNode = this.store.representative(this.focusedNode);
      this.includedNodes = this.store.collapsedNodeMask?.slice() ?? null;
      if (this.includedNodes) {
        for (let node = 0; node < snapshot.nodeCount; node += 1) {
          if (eligible[node] !== 1) this.includedNodes[node] = 0;
        }
      }
      if (collapsedChanged) this.refreshProjectedGraph();
      return;
    }
    this.store.setCollapsedCommunities([], null);
    if (!local && !this.metadataNodes) {
      this.includedNodes = null;
      return;
    }
    const included = new Uint8Array(snapshot.nodeCount);
    for (let node = 0; node < snapshot.nodeCount; node += 1) {
      included[node] = (local === null || local[node] === 1)
        && (this.metadataNodes === null || this.metadataNodes[node] === 1)
        ? 1
        : 0;
    }
    this.includedNodes = included;
  }

  private refreshProjectedGraph(): void {
    const snapshot = this.store.snapshot;
    if (!snapshot) return;
    this.uploadClusterTexture();
    this.uploadEdges();
    this.refreshSuggestedEdges();
    this.relight();
  }

  private refreshSuggestedEdges(): void {
    const source = this.store.representative(this.suggestedSource);
    const edges: number[] = [];
    if (source >= 0) {
      this.suggestedTargets.forEach((target) => {
        const representative = this.store.representative(target);
        if (representative >= 0 && representative !== source) edges.push(source, representative);
      });
    }
    this.scene.uploadSuggestions(new Uint32Array(edges));
    this.suggestedEdgeCount = edges.length / 2;
  }

  clearPath(): void {
    this.pathMode = false;
    this.pathStart = -1;
    this.pathNodes = null;
    this.onPathState?.({ status: 'idle' });
    this.relight();
  }

  hasSnapshot(): boolean {
    return this.store.snapshot !== null;
  }

  resize(): void {
    const { metrics, resized } = this.sizer.read();
    this.cssWidth = metrics.cssWidth;
    this.cssHeight = metrics.cssHeight;
    if (!resized) return;
    this.ratio = metrics.ratio;
    this.scene.setViewport(metrics.deviceWidth, metrics.deviceHeight, metrics.ratio);
    this.labelLayer.resize(metrics.cssWidth, metrics.cssHeight);
    this.labelLayer.restyle(this.typography(), metrics.ratio);
    this.draw(0);
    if (this.labelsAnimating) this.invalidate();
  }

  refreshPalette(): void {
    this.palette = readPalette(this.canvas);
    this.uploadCustomGroupColors();
    this.labelLayer.restyle(this.typography(), this.ratio);
    if (motionEnabled()) this.invalidate();
    else this.finishMotionIfDisabled();
  }

  private typography(): LabelTypography {
    const styles = getComputedStyle(this.canvas);
    const size = Number.parseFloat(styles.fontSize) || 12;
    const declared = Number.parseFloat(styles.lineHeight);
    return {
      font: `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`,
      lineHeight: Number.isFinite(declared) ? declared : Math.round(size * 1.35),
    };
  }

  dispose(): void {
    this.saveCameraNow();
    this.clock.stop();
    this.motionQuery.removeEventListener('change', this.handleMotionChange);
    document.documentElement.removeEventListener('aquilum-motion-change', this.handleMotionChange);
    this.themeWatcher.disconnect();
    this.interaction.detach();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.sizer.dispose();
    this.scene.dispose();
  }

  private markCameraMoved(): void {
    if (this.cameraSaveTimer) window.clearTimeout(this.cameraSaveTimer);
    this.cameraSaveTimer = window.setTimeout(() => {
      this.cameraSaveTimer = 0;
      this.onCameraSettled?.(this.cameraState());
    }, CAMERA_SETTLE_MS);
  }

  private saveCameraNow(): void {
    window.clearTimeout(this.cameraSaveTimer);
    this.cameraSaveTimer = 0;
    if (this.store.snapshot) this.onCameraSettled?.(this.cameraState());
  }

  private jumpToFit(): void {
    if (!this.store.snapshot) return;
    this.camera.jumpTo(this.store.bounds(this.display.spread), this.cssWidth, this.cssHeight);
    this.invalidate();
  }

  private nodeAt(centeredX: number, centeredY: number): number {
    const grid = this.store.grid;
    const snapshot = this.store.snapshot;
    if (!snapshot || !grid) return -1;
    const world = this.camera.toWorld(centeredX, centeredY);
    const node = pickNode(
      grid,
      snapshot,
      world.x,
      world.y,
      this.camera.scale,
      this.display.nodeSize,
      this.display.spread,
    );
    if (node < 0) return -1;
    return snapshot.createdDays[node] < this.display.createdFrom
      || snapshot.createdDays[node] > this.display.createdTo
      || snapshot.modifiedDays[node] < this.display.modifiedFrom
      || snapshot.modifiedDays[node] > this.display.modifiedTo
      || (this.includedNodes !== null && this.includedNodes[node] !== 1)
      ? -1
      : node;
  }

  private relight(): void {
    if (this.pathNodes !== null) this.highlight.lightNodes(this.pathNodes);
    else this.highlight.lightUp(this.store.adjacency, this.interaction.node, this.display.highlightDepth);
    this.highlightAnimating = true;
    this.invalidate();
  }

  private selectNode(node: number): void {
    if (!this.pathMode) {
      this.focusedNode = node;
      this.store.setEdgeDirection(this.display.edgeDirection, node);
      this.updateIncludedNodes();
      this.refilter();
      this.uploadEdges();
      this.invalidate();
      this.onSelect?.(node);
      return;
    }
    if (this.pathStart < 0) {
      this.pathStart = node;
      this.pathNodes = [node];
      this.onPathState?.({ status: 'selectEnd' });
      this.relight();
      return;
    }
    const snapshot = this.store.snapshot;
    const path = this.store.adjacency && snapshot
      ? shortestPath(this.store.adjacency, this.pathStart, node, (member) =>
        this.isNodeIncluded(member))
      : null;
    this.pathStart = -1;
    this.pathNodes = path ?? [];
    this.onPathState?.(path
      ? { status: 'found', nodeCount: path.length }
      : { status: 'missing' });
    this.relight();
  }

  private isNodeIncluded(node: number): boolean {
    const snapshot = this.store.snapshot;
    return snapshot !== null
      && !(snapshot.createdDays[node] < this.display.createdFrom
        || snapshot.createdDays[node] > this.display.createdTo
        || snapshot.modifiedDays[node] < this.display.modifiedFrom
        || snapshot.modifiedDays[node] > this.display.modifiedTo)
      && (this.includedNodes === null || this.includedNodes[node] === 1);
  }

  private uploadHighlight(): void {
    const { firstRow, rowCount } = this.highlight.dirtyRows();
    this.scene.textures.uploadHighlightRows(this.highlight.data, firstRow, rowCount);
    this.highlight.settle();
  }

  private uploadReveal(): void {
    const { firstRow, rowCount } = this.filter.dirtyRows();
    this.scene.textures.uploadRevealRows(this.filter.data, firstRow, rowCount);
    this.filter.settle();
  }

  private refilter(): void {
    const snapshot = this.store.snapshot;
    if (!snapshot) return;
    this.filter.retarget(
      snapshot.createdDays,
      snapshot.nodeCount,
      this.display.createdFrom,
      snapshot.modifiedDays,
      this.display.modifiedFrom,
      this.includedNodes,
      this.display.createdTo,
      this.display.modifiedTo,
    );
    this.reportVisible();
  }

  private reportVisible(): void {
    if (this.filter.visible === this.visibleNodes) return;
    this.visibleNodes = this.filter.visible;
    this.onVisibleNodes?.(this.visibleNodes);
  }

  private invalidate(): void {
    this.clock.request(this.step);
  }

  private uploadEdges(): void {
    this.uploadGraphEdges();
    this.scene.uploadTransitionEdges(
      this.store.renderTransitionEdges,
      this.store.renderTransitionArrowEdges,
      this.store.renderTransitionEdgeTarget,
      this.store.renderTransitionArrowTarget,
    );
  }

  private uploadGraphEdges(): void {
    this.scene.uploadEdges(this.store.renderEdges);
    this.uploadGraphArrows();
  }

  private uploadGraphArrows(): void {
    this.scene.uploadArrows(this.store.renderArrowEdges);
  }

  private finishMotionIfDisabled(): void {
    if (motionEnabled()) return;
    this.clock.stop();
    this.step(0, 0, false);
  }

  private readonly step: FrameStep = (seconds, time, animate) => {
    const movedNode = this.store.takeMovedNode();
    if (movedNode >= 0) this.scene.textures.uploadNode(this.store.texels, movedNode);
    const zooming = animate ? this.camera.advance(seconds) : this.camera.finish();
    const wasMorphing = this.store.isMorphing();
    const moved = animate ? this.store.advanceMorph(seconds) : this.store.finishMorph();
    if (moved) {
      this.scene.textures.uploadNodes(this.store.texels, this.store.rows);
      if (wasMorphing && !this.store.isMorphing()) this.uploadEdges();
    }
    const morphing = this.store.isMorphing();
    this.interaction.resolveHover();
    this.highlightAnimating = this.highlight.advance(seconds, animate);
    this.uploadHighlight();
    const revealing = this.filter.advance(seconds, animate);
    this.uploadReveal();
    if (!morphing && !revealing && this.store.hasGhosts) {
      this.store.dropGhosts(this.display.edgeType, this.display.edgeDirection, this.focusedNode);
      this.scene.textures.uploadNodes(this.store.texels, this.store.rows);
      this.filter.adopt(
        this.store.snapshot!.createdDays,
        this.store.nodeCount,
        this.store.rows,
        this.display.createdFrom,
        [],
        0,
        this.store.snapshot!.modifiedDays,
        this.display.modifiedFrom,
        this.includedNodes,
        this.display.createdTo,
        this.display.modifiedTo,
      );
      this.scene.textures.allocateReveal(this.filter.data, this.store.rows);
      this.uploadEdges();
    }
    this.draw(seconds, animate);
    const continues = animate && (zooming
      || morphing
      || revealing
      || this.labelsAnimating
      || this.highlightAnimating);
    this.readout.paint(this.camera.scale, time, continues);
    const pending = continues ? null : this.store.takeQueuedSnapshot();
    if (pending) {
      this.setSnapshot(pending.snapshot, pending.keepCamera);
      return true;
    }
    return continues;
  };

  private draw(seconds: number, animate = true): void {
    this.scene.beginFrame();
    if (this.store.nodeCount === 0) {
      this.labelsAnimating = false;
      this.highlightAnimating = false;
      return;
    }
    const display = this.display;
    const hovered = this.interaction.node;
    const dimming = this.highlight.dimming;
    const edgeCount = this.store.renderEdges.length / 2;
    const view = {
      centerX: this.camera.centerX,
      centerY: this.camera.centerY,
      deviceScale: this.camera.scale * this.ratio,
      spread: display.spread,
    };
    this.scene.drawEdges(view, {
      drawnEdges: Math.min(edgeCount, MAX_EDGES_PER_FRAME),
      drawnArrows: Math.min(this.store.renderArrowEdges.length / 2, MAX_EDGES_PER_FRAME),
      edgeCount,
      dimming,
      width: display.edgeWidth,
      opacity: display.edgeOpacity,
      style: display.edgeStyle,
      color: display.edgeColor,
      customColor: display.edgeCustomColor,
      arrows: display.arrows,
    }, this.palette);
    const transitionEdgeCount = this.store.renderTransitionEdges.length / 2;
    if (transitionEdgeCount > 0) {
      this.scene.drawTransitionEdges(view, {
        drawnEdges: Math.min(transitionEdgeCount, MAX_EDGES_PER_FRAME),
        drawnArrows: Math.min(this.store.renderTransitionArrowEdges.length / 2, MAX_EDGES_PER_FRAME),
        edgeCount: transitionEdgeCount,
        dimming,
        width: display.edgeWidth,
        opacity: display.edgeOpacity,
        style: display.edgeStyle,
        color: display.edgeColor,
        customColor: display.edgeCustomColor,
        arrows: display.arrows,
      }, this.palette, this.store.transitionProgress);
    }
    this.scene.drawSuggestedEdges(view, this.suggestedEdgeCount, this.palette);
    const heat = display.heatmapAxis === 'created' ? this.store.created : this.store.freshness;
    this.scene.drawNodes(view, {
      nodeCount: this.store.renderNodeCount,
      sourceNodeCount: this.store.nodeCount,
      sizeScale: display.nodeSize,
      dimming,
      orphanHighlight: !this.metricsStale && display.orphanHighlight,
      islandHighlight: !this.metricsStale && display.islandHighlight,
      importantNodes: !this.metricsStale && display.importantNodes,
      communityColors: !this.metricsStale && display.communityColors,
      customGroupColors: display.customGroupColors,
      heatmap: display.heatmapAxis !== 'none',
      heatCreated: display.heatmapAxis === 'created',
      oldest: heat.oldest,
      newest: heat.newest,
    }, this.palette);
    this.labelsAnimating = display.labels && this.labelLayer.draw({
      nodes: this.store,
      grid: this.store.grid,
      centerX: this.camera.centerX,
      centerY: this.camera.centerY,
      scale: this.camera.scale,
      sizeScale: display.nodeSize,
      spread: display.spread,
      createdFrom: display.createdFrom,
      createdTo: display.createdTo,
      modifiedFrom: display.modifiedFrom,
      modifiedTo: display.modifiedTo,
      includedNodes: this.includedNodes,
      hovered,
    }, seconds, (node) => dimmedBy(this.highlight.stateOf(node), dimming), animate);
    if (display.labels) this.scene.drawLabels(this.palette);
  }

  private uploadClusterTexture(): void {
    const snapshot = this.store.snapshot;
    if (!snapshot) return;
    this.scene.textures.uploadClusters(
      snapshot.clusterIds,
      this.store.islandNodes,
      this.store.rows,
      this.customGroupIds,
    );
  }

  private uploadCustomGroupColors(): void {
    if (this.customGroupRules.length === 0) return;
    this.scene.textures.uploadCustomGroupColors(groupRuleColors(this.customGroupRules, this.palette));
  }
}

function matches(current: GraphDisplay, next: GraphDisplay): boolean {
  return current.nodeSize === next.nodeSize
    && current.spread === next.spread
    && current.labelDensity === next.labelDensity
    && current.highlightDepth === next.highlightDepth
    && current.labels === next.labels
    && current.orphanHighlight === next.orphanHighlight
    && current.islandHighlight === next.islandHighlight
    && current.importantNodes === next.importantNodes
    && current.communityColors === next.communityColors
    && current.customGroupColors === next.customGroupColors
    && current.groupRules === next.groupRules
    && current.communityResolution === next.communityResolution
    && current.heatmapAxis === next.heatmapAxis
    && current.edgeWidth === next.edgeWidth
    && current.edgeOpacity === next.edgeOpacity
    && current.edgeStyle === next.edgeStyle
    && current.edgeColor === next.edgeColor
    && current.edgeCustomColor === next.edgeCustomColor
    && current.arrows === next.arrows
    && current.edgeType === next.edgeType
    && current.edgeDirection === next.edgeDirection
    && current.createdFrom === next.createdFrom
    && current.createdTo === next.createdTo
    && current.modifiedFrom === next.modifiedFrom
    && current.modifiedTo === next.modifiedTo;
}
