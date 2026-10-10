import type { GraphSnapshot, GraphTopologyDelta } from '../../modules/graph';
import type { GraphEdgeDirection, GraphEdgeType } from './graphDisplay';

interface Contribution {
  key: number;
  left: number;
  right: number;
  directions: number;
  types: number;
}

interface Aggregate {
  dense: number;
  contributors: number;
}

const EDGE_MASK_WIDTH = 34;
const TYPE_MASK_WIDTH = 32;
const ADJACENCY_TYPE_MASK_WIDTH = TYPE_MASK_WIDTH;

export class FilteredEdgeIndex {
  constructor(private readonly adjacencyOnly = false) {}

  private readonly keyToAggregate = new Map<number, Aggregate>();
  private readonly arrowKeyToDense = new Map<string, number>();
  private readonly slotContributions: Array<Contribution | null> = [];
  private denseKeys: number[] = [];
  private edgePairs = new Uint32Array(0);
  private edgeDirections = new Uint32Array(0);
  private edgeTypes = new Uint32Array(0);
  private edgeBitCounts = new Uint32Array(0);
  private edgeCount = 0;
  private arrowPairs = new Uint32Array(0);
  private arrowKeys: string[] = [];
  private arrowCount = 0;
  readonly changedEdges: number[] = [];
  readonly changedArrows: number[] = [];
  private readonly changedAggregateBefore = new Map<number, { left: number; right: number; types: number }>();
  private nodeCount = 0;
  private projected = false;
  private edgeType: GraphEdgeType = 'all';
  private edgeDirection: GraphEdgeDirection = 'all';
  private focusedNode = -1;
  private representatives: Uint32Array | null = null;
  private allowedNodes: Uint8Array | null = null;
  private retainUndirected = false;

  get edges(): Uint32Array {
    return this.edgePairs.subarray(0, this.edgeCount * 2);
  }

  get directions(): Uint32Array {
    return this.edgeDirections.subarray(0, this.edgeCount);
  }

  get types(): Uint32Array {
    return this.edgeTypes.subarray(0, this.edgeCount);
  }

  get arrows(): Uint32Array {
    return this.arrowPairs.subarray(0, this.arrowCount * 2);
  }

  rebuild(
    snapshot: GraphSnapshot,
    edgeType: GraphEdgeType,
    edgeDirection: GraphEdgeDirection,
    focusedNode: number,
    representatives: Uint32Array | null,
    allowedNodes: Uint8Array | null,
    retainUndirected = false,
  ): void {
    this.reset();
    this.nodeCount = snapshot.nodeCount;
    this.edgeType = edgeType;
    this.edgeDirection = edgeDirection;
    this.focusedNode = focusedNode;
    this.representatives = representatives;
    this.allowedNodes = allowedNodes;
    this.retainUndirected = retainUndirected;
    this.projected = representatives !== null && representatives.some((representative, node) => representative !== node);
    const slots = snapshot.edgeSlotCount ?? snapshot.edgeCount;
    this.ensureSlotCapacity(slots);
    for (let slot = 0; slot < slots; slot += 1) {
      const contribution = this.contribution(
        slot,
        snapshot.edges[slot * 2],
        snapshot.edges[slot * 2 + 1],
        snapshot.edgeDirections[slot],
        snapshot.edgeTypes[slot],
      );
      if (contribution) this.add(slot, contribution);
    }
    this.changedEdges.length = 0;
    this.changedArrows.length = 0;
    this.changedAggregateBefore.clear();
  }

  clear(): void {
    this.reset();
  }

  applyUpdates(snapshot: GraphSnapshot, updates: GraphTopologyDelta['edgeUpdates']): void {
    this.changedEdges.length = 0;
    this.changedArrows.length = 0;
    this.changedAggregateBefore.clear();
    this.ensureSlotCapacity(snapshot.edgeSlotCount ?? snapshot.edgeCount);
    for (const { slot } of updates) {
      const previous = this.slotContributions[slot];
      if (previous) this.remove(previous);
      this.slotContributions[slot] = null;
      if (snapshot.edgeTypes[slot] === 0) continue;
      const next = this.contribution(
        slot,
        snapshot.edges[slot * 2],
        snapshot.edges[slot * 2 + 1],
        snapshot.edgeDirections[slot],
        snapshot.edgeTypes[slot],
      );
      if (next) this.add(slot, next);
    }
  }

  *adjacencyUpdates(): IterableIterator<{ source: number; target: number; previousTypeMask: number; typeMask: number }> {
    for (const [key, before] of this.changedAggregateBefore) {
      const aggregate = this.keyToAggregate.get(key);
      const typeMask = aggregate ? this.edgeTypes[aggregate.dense] : 0;
      if (typeMask !== before.types) {
        yield { source: before.left, target: before.right, previousTypeMask: before.types, typeMask };
      }
    }
  }

  private contribution(slot: number, source: number, target: number, typedDirections: number, types: number): Contribution | null {
    const selectedType = edgeTypeMask(this.edgeType);
    if (types === 0 || (selectedType !== 0 && (types & selectedType) === 0)) return null;
    if (this.allowedNodes && (this.allowedNodes[source] !== 1 || this.allowedNodes[target] !== 1)) return null;
    let left = this.representatives?.[source] ?? source;
    let right = this.representatives?.[target] ?? target;
    if (left === right) return null;
    let directions = this.adjacencyOnly ? 0 : directionForTypes(typedDirections, selectedType);
    if (left > right) {
      [left, right] = [right, left];
      directions = swapDirectionFlags(directions);
    }
    directions = directionForFocus(directions, left, right, this.edgeDirection, this.focusedNode);
    if (directions === 0 && !this.retainUndirected) return null;
    return {
      key: this.projected ? left * this.nodeCount + right : slot,
      left,
      right,
      directions,
      types,
    };
  }

  private add(slot: number, contribution: Contribution): void {
    let aggregate = this.keyToAggregate.get(contribution.key);
    let dense: number;
    if (!aggregate) {
      dense = this.edgeCount;
      this.ensureEdgeCapacity(dense + 1);
      aggregate = { dense, contributors: 0 };
      this.keyToAggregate.set(contribution.key, aggregate);
      this.denseKeys[dense] = contribution.key;
      this.edgePairs[dense * 2] = contribution.left;
      this.edgePairs[dense * 2 + 1] = contribution.right;
      this.edgeDirections[dense] = 0;
      this.edgeTypes[dense] = 0;
      this.edgeBitCounts.fill(0, dense * this.countWidth, (dense + 1) * this.countWidth);
      this.edgeCount += 1;
    }
    dense = aggregate.dense;
    this.rememberAggregate(contribution.key, dense, contribution.left, contribution.right);
    const previousDirections = this.edgeDirections[dense];
    if (!this.adjacencyOnly) this.adjustBits(dense, contribution.directions, 0, 1);
    this.adjustBits(dense, contribution.types, this.typeBitOffset, 1);
    aggregate.contributors += 1;
    if (!this.adjacencyOnly) {
      this.edgeDirections[dense] = this.maskFromCounts(dense, 0, 2);
      this.syncArrows(contribution.key, contribution.left, contribution.right, dense, previousDirections, this.edgeDirections[dense]);
    }
    this.edgeTypes[dense] = this.maskFromCounts(dense, this.typeBitOffset, this.typeBitWidth);
    this.slotContributions[slot] = contribution;
    this.changedEdges.push(dense);
  }

  private remove(contribution: Contribution): void {
    const aggregate = this.keyToAggregate.get(contribution.key);
    if (!aggregate) return;
    const dense = aggregate.dense;
    this.rememberAggregate(contribution.key, dense, contribution.left, contribution.right);
    const previousDirections = this.edgeDirections[dense];
    if (!this.adjacencyOnly) this.adjustBits(dense, contribution.directions, 0, -1);
    this.adjustBits(dense, contribution.types, this.typeBitOffset, -1);
    aggregate.contributors -= 1;
    if (!this.adjacencyOnly) this.edgeDirections[dense] = this.maskFromCounts(dense, 0, 2);
    this.edgeTypes[dense] = this.maskFromCounts(dense, this.typeBitOffset, this.typeBitWidth);
    if (aggregate.contributors === 0) {
      if (!this.adjacencyOnly) this.syncArrows(contribution.key, contribution.left, contribution.right, dense, previousDirections, 0);
      const last = this.edgeCount - 1;
      this.keyToAggregate.delete(contribution.key);
      if (dense !== last) {
        const movedKey = this.denseKeys[last];
        this.edgePairs[dense * 2] = this.edgePairs[last * 2];
        this.edgePairs[dense * 2 + 1] = this.edgePairs[last * 2 + 1];
        this.edgeDirections[dense] = this.edgeDirections[last];
        this.edgeTypes[dense] = this.edgeTypes[last];
        this.edgeBitCounts.copyWithin(dense * this.countWidth, last * this.countWidth, (last + 1) * this.countWidth);
        this.denseKeys[dense] = movedKey;
        const movedAggregate = this.keyToAggregate.get(movedKey);
        if (movedAggregate) movedAggregate.dense = dense;
      }
      this.edgeCount = last;
      this.changedEdges.push(dense);
      return;
    }
    if (!this.adjacencyOnly) this.syncArrows(contribution.key, contribution.left, contribution.right, dense, previousDirections, this.edgeDirections[dense]);
    this.changedEdges.push(dense);
  }

  private syncArrows(key: number, left: number, right: number, dense: number, previous: number, next: number): void {
    for (const orientation of [0, 1] as const) {
      const flag = 1 << orientation;
      if ((previous & flag) && !(next & flag)) this.removeArrow(arrowKey(key, orientation));
    }
    for (const orientation of [0, 1] as const) {
      const flag = 1 << orientation;
      if ((next & flag) && !(previous & flag)) this.addArrow(arrowKey(key, orientation), orientation === 0 ? left : right, orientation === 0 ? right : left);
    }
    this.edgeDirections[dense] = next;
  }

  private addArrow(key: string, source: number, target: number): void {
    const dense = this.arrowCount;
    this.ensureArrowCapacity(dense + 1);
    this.arrowPairs[dense * 2] = source;
    this.arrowPairs[dense * 2 + 1] = target;
    this.arrowKeys[dense] = key;
    this.arrowKeyToDense.set(key, dense);
    this.arrowCount += 1;
    this.changedArrows.push(dense);
  }

  private removeArrow(key: string): void {
    const dense = this.arrowKeyToDense.get(key);
    if (dense === undefined) return;
    const last = this.arrowCount - 1;
    this.arrowKeyToDense.delete(key);
    if (dense !== last) {
      const movedKey = this.arrowKeys[last];
      this.arrowPairs[dense * 2] = this.arrowPairs[last * 2];
      this.arrowPairs[dense * 2 + 1] = this.arrowPairs[last * 2 + 1];
      this.arrowKeys[dense] = movedKey;
      this.arrowKeyToDense.set(movedKey, dense);
    }
    this.arrowCount = last;
    this.changedArrows.push(dense);
  }

  private adjustBits(dense: number, mask: number, offset: number, amount: number): void {
    const bitCount = Math.min(TYPE_MASK_WIDTH, this.countWidth - offset);
    for (let bit = 0; bit < bitCount; bit += 1) {
      if (mask & (1 << bit)) this.edgeBitCounts[dense * this.countWidth + offset + bit] += amount;
    }
  }

  private rememberAggregate(key: number, dense: number, left: number, right: number): void {
    if (!this.changedAggregateBefore.has(key)) {
      this.changedAggregateBefore.set(key, { left, right, types: this.edgeTypes[dense] });
    }
  }

  private maskFromCounts(dense: number, offset: number, bitCount = 32): number {
    let mask = 0;
    const start = dense * this.countWidth + offset;
    for (let bit = 0; bit < bitCount; bit += 1) {
      if (this.edgeBitCounts[start + bit] > 0) mask |= 1 << bit;
    }
    return mask >>> 0;
  }

  private ensureSlotCapacity(required: number): void {
    if (this.slotContributions.length < required) this.slotContributions.length = Math.max(required, this.slotContributions.length * 2, 8);
  }

  private ensureEdgeCapacity(required: number): void {
    if (this.edgeDirections.length >= required) return;
    const capacity = Math.max(required, this.edgeDirections.length * 2, 8);
    this.edgePairs = grow(this.edgePairs, capacity * 2, this.edgeCount * 2);
    this.edgeDirections = grow(this.edgeDirections, capacity, this.edgeCount);
    this.edgeTypes = grow(this.edgeTypes, capacity, this.edgeCount);
    this.edgeBitCounts = grow(this.edgeBitCounts, capacity * this.countWidth, this.edgeCount * this.countWidth);
  }

  private ensureArrowCapacity(required: number): void {
    if (this.arrowPairs.length / 2 >= required) return;
    const capacity = Math.max(required, this.arrowPairs.length, 8);
    this.arrowPairs = grow(this.arrowPairs, capacity * 2, this.arrowCount * 2);
  }

  private reset(): void {
    this.keyToAggregate.clear();
    this.arrowKeyToDense.clear();
    this.slotContributions.length = 0;
    this.denseKeys = [];
    this.edgePairs = new Uint32Array(0);
    this.edgeDirections = new Uint32Array(0);
    this.edgeTypes = new Uint32Array(0);
    this.edgeBitCounts = new Uint32Array(0);
    this.edgeCount = 0;
    this.arrowPairs = new Uint32Array(0);
    this.arrowKeys = [];
    this.arrowCount = 0;
    this.changedEdges.length = 0;
    this.changedArrows.length = 0;
    this.changedAggregateBefore.clear();
  }

  private get countWidth(): number {
    return this.adjacencyOnly ? ADJACENCY_TYPE_MASK_WIDTH : EDGE_MASK_WIDTH;
  }

  private get typeBitOffset(): number {
    return this.adjacencyOnly ? 0 : 2;
  }

  private get typeBitWidth(): number {
    return this.adjacencyOnly ? ADJACENCY_TYPE_MASK_WIDTH : TYPE_MASK_WIDTH;
  }
}

function grow(source: Uint32Array, length: number, used: number): Uint32Array {
  const next = new Uint32Array(length);
  next.set(source.subarray(0, used));
  return next;
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

function directionForTypes(typedDirections: number, types: number): number {
  const selected = types === 0 ? 0x3f : types;
  return (typedDirections & selected ? 1 : 0)
    | ((typedDirections >>> 6) & selected ? 2 : 0);
}

function swapDirectionFlags(directions: number): number {
  return ((directions & 1) << 1) | ((directions & 2) >> 1);
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
  return mask & (direction === 'outgoing' ? outgoing : incoming);
}

function arrowKey(key: number, orientation: number): string {
  return `${key}:${orientation}`;
}
