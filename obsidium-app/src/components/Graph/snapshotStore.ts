import {
  graphBounds,
  type GraphBounds,
  type GraphSnapshot,
  type GraphTopologyDelta,
} from '../../modules/graph';
import {
  applyAdjacencyEdgeUpdates,
  buildAdjacency,
  type Adjacency,
  type AdjacencyEdgeUpdate,
} from './adjacency';
import { freshnessTexels, nodeTexels, nodeTextureRows } from './nodeMetrics';
import { buildPickGrid, type PickGrid } from './pickGrid';
import type { GraphEdgeDirection, GraphEdgeType } from './graphDisplay';
import { communityProjection } from './communityCollapse';
import { FilteredEdgeIndex } from './filteredEdgeIndex';

const ANIMATED_NODE_LIMIT = 100_000;
const MORPH_SECONDS = 0.45;

export interface GraphDateRange {
  oldest: number;
  newest: number;
  modifiedOldest: number;
  modifiedNewest: number;
}

interface DayRange {
  oldest: number;
  newest: number;
}

interface DisplayPositions {
  x(node: number): number;
  y(node: number): number;
}

export interface QueuedGraphSnapshot {
  snapshot: GraphSnapshot;
  keepCamera: boolean;
}

export interface NodeReader extends DisplayPositions {
  readonly nodeCount: number;
  degree(node: number): number;
  createdDay(node: number): number;
  modifiedDay(node: number): number;
}

export class SnapshotStore implements NodeReader {
  adjacency: Adjacency | null = null;
  islandNodes = new Uint8Array(0);
  collapsedNodeMask: Uint8Array | null = null;
  grid: PickGrid | null = null;
  texels = new Float32Array(0);
  renderEdges = new Uint32Array(0);
  renderEdgeDirections = new Uint32Array(0);
  renderEdgeTypes = new Uint32Array(0);
  renderArrowEdges = new Uint32Array(0);
  renderTransitionEdges = new Uint32Array(0);
  renderTransitionEdgeDirections = new Uint32Array(0);
  renderTransitionEdgeTypes = new Uint32Array(0);
  renderTransitionEdgeTarget = new Float32Array(0);
  renderTransitionArrowEdges = new Uint32Array(0);
  renderTransitionArrowTarget = new Float32Array(0);
  private allEdges = new Uint32Array(0);
  private allEdgeDirections = new Uint32Array(0);
  private allEdgeTypes = new Uint32Array(0);
  private allEdgeStorage = new Uint32Array(0);
  private allDirectionStorage = new Uint32Array(0);
  private allTypeStorage = new Uint32Array(0);
  private edgeSlotToDense = new Int32Array(0);
  private denseToEdgeSlot = new Uint32Array(0);
  private renderEdgeCount = 0;
  private renderDirectionStorage = new Uint32Array(0);
  private arrowStorage = new Uint32Array(0);
  private arrowKeyToDense = new Int32Array(0);
  private denseArrowToKey = new Uint32Array(0);
  private allEdgeCount = 0;
  private arrowCount = 0;
  private readonly changedRenderEdges: number[] = [];
  private readonly changedRenderArrows: number[] = [];
  private readonly adjacencyUpdates: AdjacencyEdgeUpdate[] = [];
  private readonly filteredEdgeIndex = new FilteredEdgeIndex();
  private readonly adjacencyEdgeIndex = new FilteredEdgeIndex(true);
  private filteredEdgeIndexActive = false;
  private allEdgesDirty = false;
  sparseEdgeUpdate = false;
  private transitionEdges = new Uint32Array(0);
  private transitionDirections = new Uint32Array(0);
  private transitionTypes = new Uint32Array(0);
  private transitionTargets = new Float32Array(0);
  private renderedTransitionSources = new Uint32Array(0);
  private edgeType: GraphEdgeType = 'all';
  private edgeDirection: GraphEdgeDirection = 'all';
  private focusedNode = -1;
  private collapsedCommunities: number[] = [];
  private nodeRepresentatives: Uint32Array | null = null;
  private collapseAllowedNodes: Uint8Array | null = null;
  private collapseRepresentativeCandidates: Uint8Array | null = null;
  renderNodeCount = 0;
  enteringNodes: number[] = [];
  rows = 1;
  freshness: DayRange = { oldest: 0, newest: 1 };
  created: DayRange = { oldest: 0, newest: 1 };
  private freshnessCounts = new Map<number, number>();
  private freshnessHeap: number[] = [];
  private current: GraphSnapshot | null = null;
  private previousSnapshot: GraphSnapshot | null = null;
  private ghostSource: number[] = [];
  private previousPositions: Float32Array | null = null;
  private transition = 1;
  private movedNode = -1;
  private positionsDirty = false;
  private queuedSnapshot: QueuedGraphSnapshot | null = null;

  get snapshot(): GraphSnapshot | null {
    return this.current;
  }

  get nodeCount(): number {
    return this.current?.nodeCount ?? 0;
  }

  get edgeCount(): number {
    return this.current?.edgeCount ?? 0;
  }

  get changedRenderEdgeIndices(): number[] {
    return this.filteredEdgeIndexActive ? this.filteredEdgeIndex.changedEdges : this.changedRenderEdges;
  }

  get changedRenderArrowIndices(): number[] {
    return this.filteredEdgeIndexActive ? this.filteredEdgeIndex.changedArrows : this.changedRenderArrows;
  }

  get transitionProgress(): number {
    return this.transition;
  }

  queueSnapshot(snapshot: GraphSnapshot, keepCamera: boolean): void {
    this.queuedSnapshot = { snapshot, keepCamera };
  }

  takeQueuedSnapshot(): QueuedGraphSnapshot | null {
    const queued = this.queuedSnapshot;
    this.queuedSnapshot = null;
    return queued;
  }

  clearQueuedSnapshot(): void {
    this.queuedSnapshot = null;
  }

  applyModifiedDateUpdates(updates: readonly { index: number; modifiedDay: number }[]): boolean {
    const snapshot = this.current;
    if (!snapshot || updates.length === 0 || updates.some(({ index, modifiedDay }) =>
      !Number.isInteger(index) || index < 0 || index >= snapshot.nodeCount || !Number.isFinite(modifiedDay)
      || modifiedDay < snapshot.modifiedDays[index])) {
      return false;
    }
    for (const { index, modifiedDay } of updates) {
      const previousDay = snapshot.modifiedDays[index];
      this.adjustFreshnessCount(previousDay, -1);
      this.adjustFreshnessCount(modifiedDay, 1);
      snapshot.modifiedDays[index] = modifiedDay;
      this.freshness.newest = Math.max(this.freshness.newest, modifiedDay);
    }
    this.refreshFreshnessBounds();
    return true;
  }

  applyTopologyDelta(delta: GraphTopologyDelta, sinceRevision: number): boolean {
    this.sparseEdgeUpdate = false;
    this.changedRenderEdges.length = 0;
    this.changedRenderArrows.length = 0;
    const snapshot = this.current;
    const oldSlotCount = snapshot ? edgeSlotCount(snapshot) : 0;
    if (!delta || typeof delta !== 'object' || !snapshot
      || this.isMorphing() || this.hasGhosts
      || !Number.isSafeInteger(sinceRevision) || sinceRevision < 0
      || !Number.isSafeInteger(delta.revision) || delta.revision <= sinceRevision
      || !isUint32(delta.baseEpochLow) || !isUint32(delta.baseEpochHigh)
      || delta.baseEpochLow !== snapshot.epoch.low || delta.baseEpochHigh !== snapshot.epoch.high
      || typeof delta.metricsStale !== 'boolean'
      || !isUint32(oldSlotCount)
      || !isUint32(snapshot.edgeCount) || snapshot.edgeCount > oldSlotCount
      || !isUint32(delta.edgeSlotCount) || delta.edgeSlotCount < oldSlotCount
      || !isUint32(delta.edgeCount)
      || delta.edgeCount > delta.edgeSlotCount
      || !Array.isArray(delta.nodeUpdates) || !Array.isArray(delta.edgeUpdates)
      || snapshot.edges.length < oldSlotCount * 2
      || snapshot.edgeDirections.length < oldSlotCount
      || snapshot.edgeTypes.length < oldSlotCount
      || snapshot.degrees.length < snapshot.nodeCount) return false;

    const updatedNodes = new Set<number>();
    for (const update of delta.nodeUpdates) {
      if (!update || !isUint32(update.index) || update.index >= snapshot.nodeCount
        || !isUint32(update.degree) || updatedNodes.has(update.index)
        || (update.modifiedDay !== undefined && !Number.isFinite(update.modifiedDay))) return false;
      updatedNodes.add(update.index);
    }
    if (!this.collapseProjectionStable(snapshot, delta.nodeUpdates, delta.metricsStale)) return false;

    const updatedSlots = new Set<number>();
    let liveEdgeCount = snapshot.edgeCount;
    const appendedSlots = new Map<number, number>();
    for (const update of delta.edgeUpdates) {
      if (!update || !isUint32(update.slot) || update.slot >= delta.edgeSlotCount
        || !isUint32(update.source) || update.source >= snapshot.nodeCount
        || !isUint32(update.target) || update.target >= snapshot.nodeCount
        || !isUint32(update.directionMask) || !isUint32(update.typeMask)
        || (update.typeMask === 0 && update.directionMask !== 0)
        || updatedSlots.has(update.slot)) return false;
      updatedSlots.add(update.slot);
      if (update.slot < oldSlotCount) {
        if (snapshot.edges[update.slot * 2] !== update.source
          || snapshot.edges[update.slot * 2 + 1] !== update.target) return false;
        const wasLive = snapshot.edgeTypes[update.slot] !== 0;
        if (!wasLive && update.typeMask !== 0) return false;
        if (wasLive && update.typeMask === 0) liveEdgeCount -= 1;
      } else {
        appendedSlots.set(update.slot, update.typeMask);
        if (update.typeMask !== 0) liveEdgeCount += 1;
      }
    }
    for (let slot = oldSlotCount; slot < delta.edgeSlotCount; slot += 1) {
      if (!appendedSlots.has(slot) || appendedSlots.get(slot) === 0) {
        return false;
      }
    }
    if (liveEdgeCount !== delta.edgeCount) return false;
    if (delta.edgeUpdates.length === 0) {
      if (delta.edgeSlotCount !== oldSlotCount || delta.edgeCount !== snapshot.edgeCount) return false;
      snapshot.metricsStale = snapshot.metricsStale === true || delta.metricsStale;
      this.applyNodeUpdates(snapshot, delta.nodeUpdates);
      return true;
    }

    this.adjacencyUpdates.length = 0;
    if (!this.nodeRepresentatives) {
      for (const update of delta.edgeUpdates) {
        this.adjacencyUpdates.push({
          source: update.source,
          target: update.target,
          previousTypeMask: update.slot < oldSlotCount ? snapshot.edgeTypes[update.slot] : 0,
          typeMask: update.typeMask,
        });
      }
    }
    const canUpdateDenseEdges = this.edgeType === 'all'
      && this.edgeDirection === 'all'
      && this.nodeRepresentatives === null;
    const capacity = Math.max(delta.edgeSlotCount, oldSlotCount * 2, 8);
    const hasCapacity = snapshot.edges.length >= delta.edgeSlotCount * 2
      && snapshot.edgeDirections.length >= delta.edgeSlotCount
      && snapshot.edgeTypes.length >= delta.edgeSlotCount;
    const edges = hasCapacity ? snapshot.edges : new Uint32Array(capacity * 2);
    const directions = hasCapacity ? snapshot.edgeDirections : new Uint32Array(capacity);
    const types = hasCapacity ? snapshot.edgeTypes : new Uint32Array(capacity);
    if (!hasCapacity) {
      edges.set(snapshot.edges.subarray(0, oldSlotCount * 2));
      directions.set(snapshot.edgeDirections.subarray(0, oldSlotCount));
      types.set(snapshot.edgeTypes.subarray(0, oldSlotCount));
    }
    for (const update of delta.edgeUpdates) {
      edges[update.slot * 2] = update.source;
      edges[update.slot * 2 + 1] = update.target;
      directions[update.slot] = update.directionMask;
      types[update.slot] = update.typeMask;
    }

    snapshot.edges = edges;
    snapshot.edgeDirections = directions;
    snapshot.edgeTypes = types;
    snapshot.edgeSlotCount = delta.edgeSlotCount;
    snapshot.edgeCount = delta.edgeCount;
    snapshot.metricsStale = snapshot.metricsStale === true || delta.metricsStale;
    this.applyNodeUpdates(snapshot, delta.nodeUpdates);
    if (canUpdateDenseEdges) {
      this.filteredEdgeIndexActive = false;
      this.allEdgesDirty = false;
      this.applyDenseEdgeUpdates(delta.edgeUpdates, delta.edgeSlotCount);
      this.sparseEdgeUpdate = true;
    } else {
      this.filteredEdgeIndex.applyUpdates(snapshot, delta.edgeUpdates);
      this.assignFilteredEdges();
      this.allEdgesDirty = true;
      this.sparseEdgeUpdate = true;
    }
    if (this.nodeRepresentatives) {
      this.adjacencyEdgeIndex.applyUpdates(snapshot, delta.edgeUpdates);
      for (const update of this.adjacencyEdgeIndex.adjacencyUpdates()) this.adjacencyUpdates.push(update);
    }
    if (!this.adjacency || !applyAdjacencyEdgeUpdates(this.adjacency, this.adjacencyUpdates)) {
      this.rebuildAdjacency(snapshot);
    }
    this.islandNodes = this.adjacency!.islandNodes;
    return true;
  }

  private applyNodeUpdates(snapshot: GraphSnapshot, updates: GraphTopologyDelta['nodeUpdates']): void {
    for (const update of updates) {
      snapshot.degrees[update.index] = update.degree;
      this.texels[update.index * 4 + 2] = update.degree;
      if (update.modifiedDay === undefined) continue;
      this.adjustFreshnessCount(snapshot.modifiedDays[update.index], -1);
      this.adjustFreshnessCount(update.modifiedDay, 1);
      snapshot.modifiedDays[update.index] = update.modifiedDay;
      this.freshness.newest = Math.max(this.freshness.newest, update.modifiedDay);
    }
    this.refreshFreshnessBounds();
  }

  private applyDenseEdgeUpdates(
    updates: GraphTopologyDelta['edgeUpdates'],
    edgeSlotCount: number,
  ): void {
    this.ensureDenseEdgeCapacity(edgeSlotCount, this.allEdgeCount + updates.length);
    const snapshot = this.current;
    if (!snapshot) return;
    for (const update of updates) {
      const slot = update.slot;
      let dense = this.edgeSlotToDense[slot];
      const oldDirections = dense >= 0 ? this.renderDirectionStorage[dense] : 0;
      if (update.typeMask === 0) {
        if (oldDirections & 1) this.removeArrow(slot, 0);
        if (oldDirections & 2) this.removeArrow(slot, 1);
        const last = this.allEdgeCount - 1;
        this.edgeSlotToDense[slot] = -1;
        if (dense !== last) {
          const movedSlot = this.denseToEdgeSlot[last];
          this.allEdgeStorage[dense * 2] = this.allEdgeStorage[last * 2];
          this.allEdgeStorage[dense * 2 + 1] = this.allEdgeStorage[last * 2 + 1];
          this.allDirectionStorage[dense] = this.allDirectionStorage[last];
          this.allTypeStorage[dense] = this.allTypeStorage[last];
          this.renderDirectionStorage[dense] = this.renderDirectionStorage[last];
          this.denseToEdgeSlot[dense] = movedSlot;
          this.edgeSlotToDense[movedSlot] = dense;
          this.changedRenderEdges.push(dense);
        }
        this.allEdgeCount = last;
        this.renderEdgeCount = last;
        continue;
      }
      if (dense < 0) {
        dense = this.allEdgeCount;
        this.allEdgeCount += 1;
        this.renderEdgeCount = this.allEdgeCount;
        this.edgeSlotToDense[slot] = dense;
        this.denseToEdgeSlot[dense] = slot;
        this.allEdgeStorage[dense * 2] = snapshot.edges[slot * 2];
        this.allEdgeStorage[dense * 2 + 1] = snapshot.edges[slot * 2 + 1];
        this.changedRenderEdges.push(dense);
      }
      this.allDirectionStorage[dense] = snapshot.edgeDirections[slot];
      this.allTypeStorage[dense] = update.typeMask;
      const directions = directionForTypes(snapshot.edgeDirections[slot], 0);
      this.renderDirectionStorage[dense] = directions;
      if ((oldDirections & 1) && !(directions & 1)) this.removeArrow(slot, 0);
      if ((oldDirections & 2) && !(directions & 2)) this.removeArrow(slot, 1);
      if (!(oldDirections & 1) && (directions & 1)) this.ensureArrow(slot, 0, dense);
      if (!(oldDirections & 2) && (directions & 2)) this.ensureArrow(slot, 1, dense);
    }
    this.allEdges = this.allEdgeStorage.subarray(0, this.allEdgeCount * 2);
    this.allEdgeDirections = this.allDirectionStorage.subarray(0, this.allEdgeCount);
    this.allEdgeTypes = this.allTypeStorage.subarray(0, this.allEdgeCount);
    this.renderEdges = this.allEdges;
    this.renderEdgeDirections = this.renderDirectionStorage.subarray(0, this.renderEdgeCount);
    this.renderEdgeTypes = this.allEdgeTypes;
    this.renderArrowEdges = this.arrowStorage.subarray(0, this.arrowCount * 2);
  }

  private ensureDenseEdgeCapacity(edgeSlotCount: number, requiredEdgeCapacity: number): void {
    const capacity = Math.max(this.allEdgeStorage.length / 2, requiredEdgeCapacity, 8);
    if (this.allEdgeStorage.length < capacity * 2) {
      this.allEdgeStorage = growUint32(this.allEdgeStorage, capacity * 2, this.allEdgeCount * 2);
      this.renderEdges = this.allEdgeStorage.subarray(0, this.allEdgeCount * 2);
    }
    if (this.allDirectionStorage.length < capacity) {
      this.allDirectionStorage = growUint32(this.allDirectionStorage, capacity, this.allEdgeCount);
      this.renderDirectionStorage = growUint32(this.renderDirectionStorage, capacity, this.renderEdgeCount);
      this.renderEdgeDirections = this.renderDirectionStorage.subarray(0, this.renderEdgeCount);
    }
    if (this.allTypeStorage.length < capacity) {
      this.allTypeStorage = growUint32(this.allTypeStorage, capacity, this.allEdgeCount);
    }
    if (this.denseToEdgeSlot.length < capacity) {
      this.denseToEdgeSlot = growUint32(this.denseToEdgeSlot, capacity, this.allEdgeCount);
    }
    if (this.edgeSlotToDense.length < edgeSlotCount) {
      const previousLength = this.edgeSlotToDense.length;
      const next = growInt32(this.edgeSlotToDense, Math.max(edgeSlotCount, previousLength * 2, 8));
      next.fill(-1, previousLength);
      this.edgeSlotToDense = next;
    }
    const arrowCapacity = capacity * 2;
    if (this.arrowStorage.length < arrowCapacity * 2) {
      this.arrowStorage = growUint32(this.arrowStorage, arrowCapacity * 2, this.arrowCount * 2);
      this.renderArrowEdges = this.arrowStorage.subarray(0, this.arrowCount * 2);
    }
    if (this.denseArrowToKey.length < arrowCapacity) {
      this.denseArrowToKey = growUint32(this.denseArrowToKey, arrowCapacity, this.arrowCount);
    }
    if (this.arrowKeyToDense.length < edgeSlotCount * 2) {
      const previousLength = this.arrowKeyToDense.length;
      const next = growInt32(this.arrowKeyToDense, Math.max(edgeSlotCount * 2, previousLength * 2, 8));
      next.fill(-1, previousLength);
      this.arrowKeyToDense = next;
    }
  }

  private ensureArrow(slot: number, orientation: 0 | 1, edgeDense: number): void {
    const key = slot * 2 + orientation;
    if (this.arrowKeyToDense[key] >= 0) return;
    const dense = this.arrowCount;
    const left = this.allEdgeStorage[edgeDense * 2];
    const right = this.allEdgeStorage[edgeDense * 2 + 1];
    this.arrowStorage[dense * 2] = orientation === 0 ? left : right;
    this.arrowStorage[dense * 2 + 1] = orientation === 0 ? right : left;
    this.arrowKeyToDense[key] = dense;
    this.denseArrowToKey[dense] = key;
    this.arrowCount += 1;
    this.changedRenderArrows.push(dense);
  }

  private removeArrow(slot: number, orientation: 0 | 1): void {
    const key = slot * 2 + orientation;
    const dense = this.arrowKeyToDense[key];
    if (dense < 0) return;
    const last = this.arrowCount - 1;
    this.arrowKeyToDense[key] = -1;
    if (dense !== last) {
      const movedKey = this.denseArrowToKey[last];
      this.arrowStorage[dense * 2] = this.arrowStorage[last * 2];
      this.arrowStorage[dense * 2 + 1] = this.arrowStorage[last * 2 + 1];
      this.denseArrowToKey[dense] = movedKey;
      this.arrowKeyToDense[movedKey] = dense;
    }
    this.arrowCount = last;
    this.changedRenderArrows.push(dense);
  }

  private initializeDenseEdgeMaps(): void {
    const snapshot = this.current;
    if (!snapshot || this.edgeType !== 'all' || this.edgeDirection !== 'all' || this.nodeRepresentatives) return;
    const slots = edgeSlotCount(snapshot);
    this.allEdgeCount = this.allEdgeTypes.length;
    this.renderEdgeCount = this.renderEdgeTypes.length;
    this.allEdgeStorage = this.allEdges;
    this.allDirectionStorage = this.allEdgeDirections;
    this.allTypeStorage = this.allEdgeTypes;
    this.renderDirectionStorage = this.renderEdgeDirections;
    this.arrowStorage = this.renderArrowEdges;
    this.arrowCount = this.renderArrowEdges.length / 2;
    const reserve = Math.min(Math.max(64, Math.ceil(this.allEdgeCount / 25)), 4_096);
    this.ensureDenseEdgeCapacity(slots, this.allEdgeCount + reserve);
    this.allEdges = this.allEdgeStorage.subarray(0, this.allEdgeCount * 2);
    this.allEdgeDirections = this.allDirectionStorage.subarray(0, this.allEdgeCount);
    this.allEdgeTypes = this.allTypeStorage.subarray(0, this.allEdgeCount);
    this.renderEdges = this.allEdges;
    this.renderEdgeDirections = this.renderDirectionStorage.subarray(0, this.renderEdgeCount);
    this.renderEdgeTypes = this.allEdgeTypes;
    this.renderArrowEdges = this.arrowStorage.subarray(0, this.arrowCount * 2);
    this.edgeSlotToDense = new Int32Array(slots);
    this.edgeSlotToDense.fill(-1);
    this.denseToEdgeSlot = new Uint32Array(Math.max(this.allEdgeCount, 8));
    let dense = 0;
    for (let slot = 0; slot < slots; slot += 1) {
      if (snapshot.edgeTypes[slot] === 0) continue;
      this.edgeSlotToDense[slot] = dense;
      this.denseToEdgeSlot[dense] = slot;
      dense += 1;
    }
    const arrowSlots = slots * 2;
    this.arrowKeyToDense = new Int32Array(arrowSlots);
    this.arrowKeyToDense.fill(-1);
    this.denseArrowToKey = new Uint32Array(Math.max(arrowSlots, 8));
    let arrow = 0;
    for (let edge = 0; edge < this.renderEdgeCount; edge += 1) {
      const slot = this.denseToEdgeSlot[edge];
      const directions = this.renderEdgeDirections[edge];
      if (directions & 1) {
        const key = slot * 2;
        this.arrowKeyToDense[key] = arrow;
        this.denseArrowToKey[arrow] = key;
        arrow += 1;
      }
      if (directions & 2) {
        const key = slot * 2 + 1;
        this.arrowKeyToDense[key] = arrow;
        this.denseArrowToKey[arrow] = key;
        arrow += 1;
      }
    }
  }

  morphsInto(snapshot: GraphSnapshot, keepCamera: boolean): boolean {
    return keepCamera
      && this.current !== null
      && uniqueNodeIds(this.current)
      && uniqueNodeIds(snapshot)
      && snapshot.nodeCount <= ANIMATED_NODE_LIMIT;
  }

  adopt(
    snapshot: GraphSnapshot,
    morphs: boolean,
    edgeType: GraphEdgeType = 'all',
    edgeDirection: GraphEdgeDirection = 'all',
  ): void {
    const previous = this.current;
    const transition = morphs && previous ? matchNodes(previous, snapshot, this) : null;
    const removedPositions = transition
      ? transition.removed.map((node) => [this.x(node), this.y(node)])
      : [];
    this.previousSnapshot = transition?.removed.length ? previous : null;
    this.ghostSource = transition?.removed ?? [];
    this.previousPositions = transition?.positions ?? null;
    this.transition = morphs ? 0 : 1;
    this.current = snapshot;
    this.allEdgesDirty = false;
    this.collapsedCommunities = [];
    this.nodeRepresentatives = null;
    this.collapsedNodeMask = null;
    this.collapseAllowedNodes = null;
    this.collapseRepresentativeCandidates = null;
    this.positionsDirty = false;
    this.enteringNodes = transition?.entering ?? [];
    this.renderNodeCount = snapshot.nodeCount + this.ghostSource.length;
    const edges = transition && previous
      ? transitionEdges(previous, snapshot, transition.previousToNext, this.ghostSource)
      : {
        ...compactEdgeSlots(snapshot),
        transitionPairs: new Uint32Array(0),
        transitionDirections: new Uint32Array(0),
        transitionTypes: new Uint32Array(0),
        transitionTargets: new Float32Array(0),
      };
    this.allEdges = edges.pairs;
    this.allEdgeDirections = edges.directions;
    this.allEdgeTypes = edges.types;
    this.allEdgesDirty = false;
    this.transitionEdges = edges.transitionPairs;
    this.transitionDirections = edges.transitionDirections;
    this.transitionTypes = edges.transitionTypes;
    this.transitionTargets = edges.transitionTargets;
    this.edgeType = edgeType;
    this.edgeDirection = edgeDirection;
    this.focusedNode = -1;
    this.grid = buildPickGrid(snapshot);
    this.freshness = dateRange(snapshot.modifiedDays, snapshot.nodeCount);
    this.freshnessCounts = new Map();
    this.freshnessHeap = [];
    for (let node = 0; node < snapshot.nodeCount; node += 1) {
      const day = snapshot.modifiedDays[node];
      if (!Number.isFinite(day)) continue;
      this.freshnessCounts.set(day, (this.freshnessCounts.get(day) ?? 0) + 1);
    }
    this.freshnessHeap = [...this.freshnessCounts.keys()];
    for (let index = Math.floor(this.freshnessHeap.length / 2) - 1; index >= 0; index -= 1) {
      siftFreshnessHeapDown(this.freshnessHeap, index);
    }
    this.created = dateRange(snapshot.createdDays, snapshot.nodeCount);
    this.rows = nodeTextureRows(this.renderNodeCount);
    this.texels = nodeTexels(snapshot, this.rows);
    if (previous && this.ghostSource.length > 0) {
      this.ghostSource.forEach((oldNode, offset) => {
        const slot = (snapshot.nodeCount + offset) * 4;
        this.texels[slot] = removedPositions[offset][0];
        this.texels[slot + 1] = removedPositions[offset][1];
        this.texels[slot + 2] = previous.degrees[oldNode];
        this.texels[slot + 3] = previous.createdDays[oldNode];
      });
    }
    this.applyEdgeFilters(true);
    if (morphs) this.writePositions(0);
  }

  setEdgeType(edgeType: GraphEdgeType): void {
    if (this.edgeType === edgeType) return;
    this.edgeType = edgeType;
    this.applyEdgeFilters(true);
  }

  setEdgeDirection(edgeDirection: GraphEdgeDirection, focusedNode: number): void {
    this.edgeDirection = edgeDirection;
    this.focusedNode = focusedNode;
    this.applyEdgeFilters(false);
  }

  setCollapsedCommunities(
    communities: number[],
    allowedNodes: Uint8Array | null,
    representativeCandidates: Uint8Array | null = allowedNodes,
  ): boolean {
    const snapshot = this.current;
    if (!snapshot) return false;
    const next = [...new Set(communities)]
      .filter((community) => Number.isInteger(community) && community >= 0 && community < snapshot.nodeCount)
      .sort((left, right) => left - right);
    const sameCommunities = next.length === this.collapsedCommunities.length
      && next.every((community, index) => community === this.collapsedCommunities[index]);
    if (sameCommunities
      && sameBytes(allowedNodes, this.collapseAllowedNodes)
      && sameBytes(representativeCandidates, this.collapseRepresentativeCandidates)) return false;
    this.collapsedCommunities = next;
    this.collapseAllowedNodes = next.length > 0 ? allowedNodes?.slice() ?? null : null;
    this.collapseRepresentativeCandidates = next.length > 0
      ? representativeCandidates?.slice() ?? null
      : null;
    const projection = next.length > 0
      ? communityProjection(snapshot, next, this.collapseRepresentativeCandidates)
      : null;
    this.nodeRepresentatives = projection?.nodeRepresentatives ?? null;
    this.collapsedNodeMask = projection?.visibleNodes ?? null;
    if (this.focusedNode >= 0 && this.nodeRepresentatives) {
      this.focusedNode = this.nodeRepresentatives[this.focusedNode];
    }
    this.applyEdgeFilters(true);
    return true;
  }

  representative(node: number): number {
    return this.nodeRepresentatives?.[node] ?? node;
  }

  private applyEdgeFilters(rebuildAdjacency: boolean): void {
    const snapshot = this.current;
    if (!snapshot) return;
    if (!this.nodeRepresentatives && this.edgeType === 'all' && this.edgeDirection === 'all') {
      this.filteredEdgeIndex.clear();
      this.filteredEdgeIndexActive = false;
      if (this.allEdgesDirty) {
        const compact = compactEdgeSlots(snapshot);
        this.allEdges = compact.pairs;
        this.allEdgeDirections = compact.directions;
        this.allEdgeTypes = compact.types;
        this.allEdgeStorage = compact.pairs;
        this.allDirectionStorage = compact.directions;
        this.allTypeStorage = compact.types;
        this.allEdgeCount = compact.types.length;
        this.allEdgesDirty = false;
      }
      this.renderEdges = this.allEdges;
      this.renderEdgeDirections = genericDirections(this.allEdgeDirections);
      this.renderEdgeTypes = this.allEdgeTypes;
      this.renderArrowEdges = directedEdges(this.renderEdges, this.renderEdgeDirections);
      this.renderEdgeCount = this.renderEdgeTypes.length;
      this.renderDirectionStorage = this.renderEdgeDirections;
      this.arrowStorage = this.renderArrowEdges;
      this.arrowCount = this.renderArrowEdges.length / 2;
      this.initializeDenseEdgeMaps();
      this.renderTransitionEdges = this.transitionEdges;
      this.renderTransitionEdgeDirections = genericDirections(this.transitionDirections);
      this.renderTransitionEdgeTypes = this.transitionTypes;
      this.renderedTransitionSources = Uint32Array.from(
        { length: this.transitionTypes.length },
        (_, index) => index,
      );
      this.updateRenderedTransitionTargets();
      if (rebuildAdjacency) {
        this.rebuildAdjacency(snapshot);
      }
      return;
    }
    this.filteredEdgeIndex.rebuild(
      snapshot,
      this.edgeType,
      this.edgeDirection,
      this.focusedNode,
      this.nodeRepresentatives,
      this.collapseAllowedNodes,
    );
    this.filteredEdgeIndexActive = true;
    this.assignFilteredEdges();
    const selectedType = this.edgeType === 'all' ? 0 : edgeTypeMask(this.edgeType);
    const transitionPairs: number[] = [];
    const transitionDirections: number[] = [];
    const transitionTypes: number[] = [];
    const transitionSources: number[] = [];
    for (let edge = 0; edge < this.transitionTypes.length; edge += 1) {
      const typeMask = this.transitionTypes[edge];
      const sourceLeft = this.transitionEdges[edge * 2];
      const sourceRight = this.transitionEdges[edge * 2 + 1];
      if (selectedType !== 0 && (typeMask & selectedType) === 0) continue;
      if (this.collapseAllowedNodes
        && (this.collapseAllowedNodes[sourceLeft] !== 1 || this.collapseAllowedNodes[sourceRight] !== 1)) continue;
      let left = this.representative(sourceLeft);
      let right = this.representative(sourceRight);
      if (left === right) continue;
      let direction = directionForTypes(this.transitionDirections[edge], selectedType);
      if (left > right) {
        [left, right] = [right, left];
        direction = swapDirectionFlags(direction);
      }
      const visibleDirection = directionForFocus(
        direction,
        left,
        right,
        this.edgeDirection,
        this.focusedNode,
      );
      if (visibleDirection === 0) continue;
      transitionPairs.push(left, right);
      transitionDirections.push(visibleDirection);
      transitionTypes.push(typeMask);
      transitionSources.push(edge);
    }
    this.renderTransitionEdges = new Uint32Array(transitionPairs);
    this.renderTransitionEdgeDirections = new Uint32Array(transitionDirections);
    this.renderTransitionEdgeTypes = new Uint32Array(transitionTypes);
    this.renderedTransitionSources = new Uint32Array(transitionSources);
    this.updateRenderedTransitionTargets();
    if (rebuildAdjacency) this.rebuildAdjacency(snapshot);
  }

  private rebuildAdjacency(snapshot: GraphSnapshot): void {
    if (!this.nodeRepresentatives) {
      this.adjacencyEdgeIndex.clear();
      this.adjacency = buildAdjacency(snapshot, this.edgeType);
      this.islandNodes = this.adjacency.islandNodes;
      return;
    }
    this.adjacencyEdgeIndex.rebuild(
      snapshot,
      'all',
      'all',
      -1,
      this.nodeRepresentatives,
      null,
      true,
    );
    const projected = this.adjacencyEdgeIndex;
    this.adjacency = buildAdjacency({
      ...snapshot,
      edgeCount: projected.types.length,
      edgeSlotCount: projected.types.length,
      edges: projected.edges,
      edgeTypes: projected.types,
    }, this.edgeType);
    this.islandNodes = this.adjacency.islandNodes;
  }

  private collapseProjectionStable(
    snapshot: GraphSnapshot,
    updates: GraphTopologyDelta['nodeUpdates'],
    metricsStale: boolean,
  ): boolean {
    if (!this.nodeRepresentatives) return true;
    if (metricsStale || snapshot.metricsStale) return false;
    for (const update of updates) {
      const changedDegree = snapshot.degrees[update.index] !== update.degree;
      const changedModifiedDay = update.modifiedDay !== undefined
        && snapshot.modifiedDays[update.index] !== update.modifiedDay;
      if (changedModifiedDay
        || (changedDegree && isCommunityCollapsed(snapshot.clusterIds[update.index], this.collapsedCommunities))) return false;
    }
    return true;
  }

  private assignFilteredEdges(): void {
    this.renderEdges = this.filteredEdgeIndex.edges;
    this.renderEdgeDirections = this.filteredEdgeIndex.directions;
    this.renderEdgeTypes = this.filteredEdgeIndex.types;
    this.renderArrowEdges = this.filteredEdgeIndex.arrows;
    this.renderEdgeCount = this.renderEdgeTypes.length;
    this.renderDirectionStorage = this.renderEdgeDirections;
    this.arrowStorage = this.renderArrowEdges;
    this.arrowCount = this.renderArrowEdges.length / 2;
  }

  freshnessTexture(): Float32Array {
    if (!this.current) return new Float32Array(0);
    const freshness = freshnessTexels(this.current, this.rows);
    const previous = this.previousSnapshot;
    if (previous) {
      this.ghostSource.forEach((oldNode, offset) => {
        freshness[this.nodeCount + offset] = previous.modifiedDays[oldNode];
      });
    }
    return freshness;
  }

  createdRange(): GraphDateRange {
    return {
      ...this.created,
      modifiedOldest: this.freshness.oldest,
      modifiedNewest: this.freshness.newest,
    };
  }

  createdDay(node: number): number {
    return this.current?.createdDays[node] ?? Number.NEGATIVE_INFINITY;
  }

  modifiedDay(node: number): number {
    return this.current?.modifiedDays[node] ?? Number.NEGATIVE_INFINITY;
  }

  private adjustFreshnessCount(day: number, adjustment: number): void {
    const count = (this.freshnessCounts.get(day) ?? 0) + adjustment;
    if (count === 0) this.freshnessCounts.delete(day);
    else this.freshnessCounts.set(day, count);
    if (adjustment > 0 && count === 1) {
      this.freshnessHeap.push(day);
      siftFreshnessHeapUp(this.freshnessHeap, this.freshnessHeap.length - 1);
    }
  }

  private refreshFreshnessBounds(): void {
    while (this.freshnessHeap.length > 0 && (this.freshnessCounts.get(this.freshnessHeap[0]) ?? 0) === 0) {
      const last = this.freshnessHeap.pop()!;
      if (this.freshnessHeap.length > 0) {
        this.freshnessHeap[0] = last;
        siftFreshnessHeapDown(this.freshnessHeap, 0);
      }
    }
    if (this.freshnessHeap.length > this.freshnessCounts.size * 2 + 32) {
      this.freshnessHeap = [...this.freshnessCounts]
        .filter(([, count]) => count > 0)
        .map(([day]) => day);
      for (let index = Math.floor(this.freshnessHeap.length / 2) - 1; index >= 0; index -= 1) {
        siftFreshnessHeapDown(this.freshnessHeap, index);
      }
    }
    if (this.freshnessHeap.length > 0) this.freshness.oldest = this.freshnessHeap[0];
  }

  degree(node: number): number {
    return this.current?.degrees[node] ?? 0;
  }

  bounds(spread: number): GraphBounds {
    const bounds = graphBounds(this.current!);
    return {
      minX: bounds.minX * spread,
      minY: bounds.minY * spread,
      maxX: bounds.maxX * spread,
      maxY: bounds.maxY * spread,
    };
  }

  isMorphing(): boolean {
    return this.transition < 1;
  }

  advanceMorph(seconds: number): boolean {
    if (this.transition >= 1) return false;
    this.transition = Math.min(1, this.transition + seconds / MORPH_SECONDS);
    this.writePositions(this.transition);
    if (this.transition >= 1) {
      this.previousPositions = null;
      this.finishEdgeTransition();
    }
    return true;
  }

  finishMorph(): boolean {
    if (this.transition >= 1) return false;
    this.transition = 1;
    this.writePositions(1);
    this.previousPositions = null;
    this.finishEdgeTransition();
    return true;
  }

  get hasGhosts(): boolean {
    return this.ghostSource.length > 0;
  }

  dropGhosts(
    edgeType: GraphEdgeType = 'all',
    edgeDirection: GraphEdgeDirection = 'all',
    focusedNode = -1,
  ): void {
    if (!this.current || !this.hasGhosts) return;
    this.renderNodeCount = this.current.nodeCount;
    const edges = compactEdgeSlots(this.current);
    this.allEdges = edges.pairs;
    this.allEdgeDirections = edges.directions;
    this.allEdgeTypes = edges.types;
    this.clearTransitionEdges();
    this.edgeType = edgeType;
    this.edgeDirection = edgeDirection;
    this.focusedNode = focusedNode;
    this.applyEdgeFilters(false);
    this.texels = nodeTexels(this.current, this.rows);
    this.previousSnapshot = null;
    this.ghostSource = [];
    this.enteringNodes = [];
  }

  moveNode(node: number, x: number, y: number): void {
    const snapshot = this.current;
    if (!snapshot || this.isMorphing() || node < 0 || node >= snapshot.nodeCount) return;
    snapshot.positions[node * 2] = x;
    snapshot.positions[node * 2 + 1] = y;
    this.texels[node * 4] = x;
    this.texels[node * 4 + 1] = y;
    this.movedNode = node;
    this.positionsDirty = true;
  }

  takeMovedNode(): number {
    const node = this.movedNode;
    this.movedNode = -1;
    return node;
  }

  finishPositionEdit(): boolean {
    if (!this.positionsDirty || !this.current) return false;
    this.movedNode = -1;
    this.positionsDirty = false;
    this.grid = buildPickGrid(this.current);
    return true;
  }

  x(node: number): number {
    return this.texels[node * 4];
  }

  y(node: number): number {
    return this.texels[node * 4 + 1];
  }

  private writePositions(progress: number): void {
    const snapshot = this.current;
    const from = this.previousPositions;
    if (!snapshot || !from) return;
    const eased = progress * progress * (3 - 2 * progress);
    for (let node = 0; node < snapshot.nodeCount; node += 1) {
      const slot = node * 4;
      const pair = node * 2;
      this.texels[slot] = from[pair] + (snapshot.positions[pair] - from[pair]) * eased;
      this.texels[slot + 1] =
        from[pair + 1] + (snapshot.positions[pair + 1] - from[pair + 1]) * eased;
    }
  }

  private updateRenderedTransitionTargets(): void {
    this.renderTransitionEdgeTarget = new Float32Array(this.renderedTransitionSources.length);
    for (let edge = 0; edge < this.renderedTransitionSources.length; edge += 1) {
      this.renderTransitionEdgeTarget[edge] = this.transitionTargets[this.renderedTransitionSources[edge]];
    }
    const arrows: number[] = [];
    const targets: number[] = [];
    for (let edge = 0; edge < this.renderTransitionEdgeDirections.length; edge += 1) {
      const left = this.renderTransitionEdges[edge * 2];
      const right = this.renderTransitionEdges[edge * 2 + 1];
      if (this.renderTransitionEdgeDirections[edge] & 1) {
        arrows.push(left, right);
        targets.push(this.renderTransitionEdgeTarget[edge]);
      }
      if (this.renderTransitionEdgeDirections[edge] & 2) {
        arrows.push(right, left);
        targets.push(this.renderTransitionEdgeTarget[edge]);
      }
    }
    this.renderTransitionArrowEdges = new Uint32Array(arrows);
    this.renderTransitionArrowTarget = new Float32Array(targets);
  }

  private finishEdgeTransition(): void {
    if (!this.current || this.transitionEdges.length === 0) return;
    const edges = compactEdgeSlots(this.current);
    this.allEdges = edges.pairs;
    this.allEdgeDirections = edges.directions;
    this.allEdgeTypes = edges.types;
    this.clearTransitionEdges();
    this.applyEdgeFilters(false);
  }

  private clearTransitionEdges(): void {
    this.transitionEdges = new Uint32Array(0);
    this.transitionDirections = new Uint32Array(0);
    this.transitionTypes = new Uint32Array(0);
    this.transitionTargets = new Float32Array(0);
    this.renderedTransitionSources = new Uint32Array(0);
    this.updateRenderedTransitionTargets();
  }
}

interface NodeTransition {
  positions: Float32Array;
  previousToNext: Uint32Array;
  removed: number[];
  entering: number[];
}

function matchNodes(
  previous: GraphSnapshot,
  next: GraphSnapshot,
  display: DisplayPositions,
): NodeTransition {
  const previousSlots = new Map<bigint, number>();
  for (let node = 0; node < previous.nodeCount; node += 1) {
    previousSlots.set(nodeId(previous, node), node);
  }
  const positions = new Float32Array(next.nodeCount * 2);
  const matched = new Uint8Array(next.nodeCount);
  const previousToNext = new Uint32Array(previous.nodeCount);
  previousToNext.fill(0xffffffff);
  const entering: number[] = [];
  let centerX = 0;
  let centerY = 0;
  let matchedCount = 0;
  for (let node = 0; node < next.nodeCount; node += 1) {
    const old = previousSlots.get(nodeId(next, node));
    if (old === undefined) {
      entering.push(node);
      continue;
    }
    previousToNext[old] = node;
    positions[node * 2] = display.x(old);
    positions[node * 2 + 1] = display.y(old);
    matched[node] = 1;
    centerX += positions[node * 2];
    centerY += positions[node * 2 + 1];
    matchedCount += 1;
  }
  if (matchedCount > 0) {
    centerX /= matchedCount;
    centerY /= matchedCount;
  }
  const neighbourX = new Float64Array(next.nodeCount);
  const neighbourY = new Float64Array(next.nodeCount);
  const neighbourCount = new Uint32Array(next.nodeCount);
  for (let edge = 0; edge < edgeSlotCount(next); edge += 1) {
    if (next.edgeTypes[edge] === 0) continue;
    const left = next.edges[edge * 2];
    const right = next.edges[edge * 2 + 1];
    if (matched[left] && !matched[right]) {
      neighbourX[right] += positions[left * 2];
      neighbourY[right] += positions[left * 2 + 1];
      neighbourCount[right] += 1;
    } else if (matched[right] && !matched[left]) {
      neighbourX[left] += positions[right * 2];
      neighbourY[left] += positions[right * 2 + 1];
      neighbourCount[left] += 1;
    }
  }
  for (let node = 0; node < next.nodeCount; node += 1) {
    if (matched[node]) continue;
    const neighbours = neighbourCount[node];
    positions[node * 2] = neighbours ? neighbourX[node] / neighbours : centerX;
    positions[node * 2 + 1] = neighbours ? neighbourY[node] / neighbours : centerY;
  }
  const removed: number[] = [];
  for (let node = 0; node < previous.nodeCount; node += 1) {
    if (previousToNext[node] === 0xffffffff) removed.push(node);
  }
  return { positions, previousToNext, removed, entering };
}

function transitionEdges(
  previous: GraphSnapshot,
  next: GraphSnapshot,
  previousToNext: Uint32Array,
  removed: number[],
): {
  pairs: Uint32Array;
  directions: Uint32Array;
  types: Uint32Array;
  transitionPairs: Uint32Array;
  transitionDirections: Uint32Array;
  transitionTypes: Uint32Array;
  transitionTargets: Float32Array;
} {
  const ghostSlot = new Uint32Array(previous.nodeCount);
  ghostSlot.fill(0xffffffff);
  removed.forEach((node, offset) => {
    ghostSlot[node] = next.nodeCount + offset;
  });
  const edges: number[] = [];
  const directions: number[] = [];
  const types: number[] = [];
  const transitionPairs: number[] = [];
  const transitionDirections: number[] = [];
  const transitionTypes: number[] = [];
  const transitionTargets: number[] = [];
  const previousByKey = new Map<string, { indices: number[]; offset: number }>();
  const matchedPrevious = new Uint8Array(edgeSlotCount(previous));
  for (let edge = 0; edge < edgeSlotCount(previous); edge += 1) {
    if (previous.edgeTypes[edge] === 0) continue;
    const key = edgeIdentity(previous, edge);
    const entry = previousByKey.get(key);
    if (entry) entry.indices.push(edge);
    else previousByKey.set(key, { indices: [edge], offset: 0 });
  }
  for (let edge = 0; edge < edgeSlotCount(next); edge += 1) {
    if (next.edgeTypes[edge] === 0) continue;
    const entry = previousByKey.get(edgeIdentity(next, edge));
    const oldEdge = entry && entry.offset < entry.indices.length ? entry.indices[entry.offset++] : undefined;
    if (oldEdge !== undefined) {
      matchedPrevious[oldEdge] = 1;
      edges.push(next.edges[edge * 2], next.edges[edge * 2 + 1]);
      directions.push(next.edgeDirections[edge]);
      types.push(next.edgeTypes[edge]);
    } else {
      transitionPairs.push(next.edges[edge * 2], next.edges[edge * 2 + 1]);
      transitionDirections.push(next.edgeDirections[edge]);
      transitionTypes.push(next.edgeTypes[edge]);
      transitionTargets.push(1);
    }
  }
  for (let edge = 0; edge < edgeSlotCount(previous); edge += 1) {
    if (previous.edgeTypes[edge] === 0 || matchedPrevious[edge]) continue;
    const oldLeft = previous.edges[edge * 2];
    const oldRight = previous.edges[edge * 2 + 1];
    const leftRemoved = ghostSlot[oldLeft] !== 0xffffffff;
    const rightRemoved = ghostSlot[oldRight] !== 0xffffffff;
    let left = leftRemoved ? ghostSlot[oldLeft] : previousToNext[oldLeft];
    let right = rightRemoved ? ghostSlot[oldRight] : previousToNext[oldRight];
    let direction = previous.edgeDirections[edge];
    if (left > right) {
      [left, right] = [right, left];
      direction = swapTypedDirections(direction);
    }
    if (leftRemoved || rightRemoved) {
      edges.push(left, right);
      directions.push(direction);
      types.push(previous.edgeTypes[edge]);
    } else {
      transitionPairs.push(left, right);
      transitionDirections.push(direction);
      transitionTypes.push(previous.edgeTypes[edge]);
      transitionTargets.push(0);
    }
  }
  return {
    pairs: new Uint32Array(edges),
    directions: new Uint32Array(directions),
    types: new Uint32Array(types),
    transitionPairs: new Uint32Array(transitionPairs),
    transitionDirections: new Uint32Array(transitionDirections),
    transitionTypes: new Uint32Array(transitionTypes),
    transitionTargets: new Float32Array(transitionTargets),
  };
}

function edgeIdentity(snapshot: GraphSnapshot, edge: number): string {
  let left = nodeId(snapshot, snapshot.edges[edge * 2]);
  let right = nodeId(snapshot, snapshot.edges[edge * 2 + 1]);
  let directions = snapshot.edgeDirections[edge];
  if (left > right) {
    [left, right] = [right, left];
    directions = swapTypedDirections(directions);
  }
  return `${left}:${right}:${directions}:${snapshot.edgeTypes[edge]}`;
}

function edgeSlotCount(snapshot: GraphSnapshot): number {
  return snapshot.edgeSlotCount ?? snapshot.edgeCount;
}

function compactEdgeSlots(snapshot: GraphSnapshot): {
  pairs: Uint32Array;
  directions: Uint32Array;
  types: Uint32Array;
} {
  const pairs: number[] = [];
  const directions: number[] = [];
  const types: number[] = [];
  for (let edge = 0; edge < edgeSlotCount(snapshot); edge += 1) {
    const type = snapshot.edgeTypes[edge];
    if (type === 0) continue;
    pairs.push(snapshot.edges[edge * 2], snapshot.edges[edge * 2 + 1]);
    directions.push(snapshot.edgeDirections[edge]);
    types.push(type);
  }
  return {
    pairs: new Uint32Array(pairs),
    directions: new Uint32Array(directions),
    types: new Uint32Array(types),
  };
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff;
}

function directedEdges(edges: Uint32Array, directions: Uint32Array): Uint32Array {
  const result: number[] = [];
  for (let edge = 0; edge < directions.length; edge += 1) {
    const left = edges[edge * 2];
    const right = edges[edge * 2 + 1];
    if (directions[edge] & 1) result.push(left, right);
    if (directions[edge] & 2) result.push(right, left);
  }
  return new Uint32Array(result);
}

function directionForTypes(typedDirections: number, types: number): number {
  const selected = types === 0 ? 0x3f : types;
  return (typedDirections & selected ? 1 : 0)
    | ((typedDirections >>> 6) & selected ? 2 : 0);
}

function genericDirections(typedDirections: Uint32Array): Uint32Array {
  const directions = new Uint32Array(typedDirections.length);
  for (let edge = 0; edge < typedDirections.length; edge += 1) {
    directions[edge] = directionForTypes(typedDirections[edge], 0);
  }
  return directions;
}

function swapTypedDirections(typedDirections: number): number {
  return ((typedDirections & 0x3f) << 6) | ((typedDirections >>> 6) & 0x3f);
}

function swapDirectionFlags(directions: number): number {
  return ((directions & 1) << 1) | ((directions & 2) >> 1);
}

function sameBytes(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function isCommunityCollapsed(community: number, collapsedCommunities: number[]): boolean {
  let low = 0;
  let high = collapsedCommunities.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = collapsedCommunities[middle];
    if (candidate === community) return true;
    if (candidate < community) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

function edgeTypeMask(edgeType: GraphEdgeType): number {
  return {
    all: 0,
    wiki: 1,
    markdown: 2,
    parent: 4,
    related: 8,
    depends_on: 16,
    blocks: 32,
  }[edgeType];
}

function directionForFocus(
  mask: number,
  left: number,
  right: number,
  direction: GraphEdgeDirection,
  focusedNode: number,
): number {
  if (direction === 'all') return mask;
  if (focusedNode !== left && focusedNode !== right) return 0;
  const outgoing = focusedNode === left ? 1 : 2;
  const incoming = focusedNode === left ? 2 : 1;
  const wanted = direction === 'outgoing' ? outgoing : incoming;
  return mask & wanted;
}

function nodeId(snapshot: GraphSnapshot, node: number): bigint {
  return (BigInt(snapshot.nodeIds[node * 2 + 1]) << 32n)
    | BigInt(snapshot.nodeIds[node * 2]);
}

function uniqueNodeIds(snapshot: GraphSnapshot): boolean {
  const ids = new Set<bigint>();
  for (let node = 0; node < snapshot.nodeCount; node += 1) {
    const id = nodeId(snapshot, node);
    if (ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

function dateRange(days: Float32Array, count: number): DayRange {
  let oldest = Infinity;
  let newest = -Infinity;
  for (let node = 0; node < count; node += 1) {
    const day = days[node];
    if (!Number.isFinite(day)) continue;
    if (day < oldest) oldest = day;
    if (day > newest) newest = day;
  }
  if (!Number.isFinite(oldest) || !Number.isFinite(newest)) return { oldest: 0, newest: 0 };
  return { oldest, newest };
}

function siftFreshnessHeapUp(heap: number[], index: number): void {
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent] <= heap[index]) return;
    [heap[parent], heap[index]] = [heap[index], heap[parent]];
    index = parent;
  }
}

function siftFreshnessHeapDown(heap: number[], index: number): void {
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && heap[left] < heap[smallest]) smallest = left;
    if (right < heap.length && heap[right] < heap[smallest]) smallest = right;
    if (smallest === index) return;
    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }
}

function growUint32(values: Uint32Array, required: number, used: number): Uint32Array {
  let capacity = Math.max(values.length, 8);
  while (capacity < required) capacity *= 2;
  const grown = new Uint32Array(capacity);
  grown.set(values.subarray(0, used));
  return grown;
}

function growInt32(values: Int32Array, required: number): Int32Array {
  let capacity = Math.max(values.length, 8);
  while (capacity < required) capacity *= 2;
  const grown = new Int32Array(capacity);
  grown.set(values);
  return grown;
}
