import { approachStep, FADE_SECONDS, SETTLED_FADE } from './easing';
import type { DirtyRows } from './highlightMap';
import { NODE_TEXTURE_WIDTH } from './nodeMetrics';

const SHOWN = 255;
const SETTLED = Math.round(SHOWN * SETTLED_FADE);

export class DateFilter {
  data = new Uint8Array(0);
  visible = 0;
  private targets = new Uint8Array(0);
  private moving = new Set<number>();
  private firstDirtyRow = Number.MAX_SAFE_INTEGER;
  private lastDirtyRow = -1;

  adopt(
    createdDays: Float32Array,
    nodeCount: number,
    rows: number,
    createdFrom: number,
    enteringNodes: number[] = [],
    exitingCount = 0,
    modifiedDays = createdDays,
    modifiedFrom = Number.NEGATIVE_INFINITY,
    includedNodes: Uint8Array | null = null,
    createdTo = Number.POSITIVE_INFINITY,
    modifiedTo = Number.POSITIVE_INFINITY,
  ): void {
    this.data = new Uint8Array(NODE_TEXTURE_WIDTH * rows);
    this.targets = new Uint8Array(NODE_TEXTURE_WIDTH * rows);
    this.retarget(createdDays, nodeCount, createdFrom, modifiedDays, modifiedFrom, includedNodes, createdTo, modifiedTo);
    this.data.set(this.targets);
    this.moving.clear();
    for (const node of enteringNodes) {
      this.data[node] = 0;
      if (this.targets[node] > 0) this.moving.add(node);
    }
    for (let node = nodeCount; node < nodeCount + exitingCount; node += 1) {
      this.data[node] = SHOWN;
      this.moving.add(node);
    }
    this.settle();
  }

  retarget(
    createdDays: Float32Array,
    nodeCount: number,
    createdFrom: number,
    modifiedDays = createdDays,
    modifiedFrom = Number.NEGATIVE_INFINITY,
    includedNodes: Uint8Array | null = null,
    createdTo = Number.POSITIVE_INFINITY,
    modifiedTo = Number.POSITIVE_INFINITY,
  ): void {
    let visible = 0;
    for (let node = 0; node < nodeCount; node += 1) {
      const shown = !(createdDays[node] < createdFrom || createdDays[node] > createdTo
        || modifiedDays[node] < modifiedFrom || modifiedDays[node] > modifiedTo)
        && (!includedNodes || includedNodes[node] === 1);
      if (shown) visible += 1;
      const target = shown ? SHOWN : 0;
      this.targets[node] = target;
      if (this.data[node] === target) this.moving.delete(node);
      else this.moving.add(node);
    }
    this.visible = visible;
  }

  setNodeShown(node: number, shown: boolean): boolean {
    const target = shown ? SHOWN : 0;
    if (!Number.isInteger(node) || node < 0 || node >= this.targets.length || this.targets[node] === target) {
      return false;
    }
    this.targets[node] = target;
    this.visible += shown ? 1 : -1;
    if (this.data[node] === target) this.moving.delete(node);
    else this.moving.add(node);
    return true;
  }

  advance(seconds: number, animate = true): boolean {
    const step = animate ? approachStep(seconds, FADE_SECONDS) : 1;
    for (const node of this.moving) {
      const goal = this.targets[node];
      const from = this.data[node];
      const gap = goal - from;
      const reveal = Math.abs(gap) <= SETTLED ? goal : from + Math.round(gap * step);
      this.data[node] = reveal;
      this.markRowDirty(node);
      if (reveal === goal) this.moving.delete(node);
    }
    return this.moving.size > 0;
  }

  dirtyRows(): DirtyRows {
    if (this.lastDirtyRow < this.firstDirtyRow) return { firstRow: 0, rowCount: 0 };
    return {
      firstRow: this.firstDirtyRow,
      rowCount: this.lastDirtyRow - this.firstDirtyRow + 1,
    };
  }

  settle(): void {
    this.firstDirtyRow = Number.MAX_SAFE_INTEGER;
    this.lastDirtyRow = -1;
  }

  private markRowDirty(node: number): void {
    const row = (node / NODE_TEXTURE_WIDTH) | 0;
    if (row < this.firstDirtyRow) this.firstDirtyRow = row;
    if (row > this.lastDirtyRow) this.lastDirtyRow = row;
  }
}
