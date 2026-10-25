import { ChangeSet, Text } from '@codemirror/state';
import type { PullResult } from '../documents/documentGateway';
import { localChange, noteEmbedBodyRange } from './noteEmbedEditing';
import type { NoteEmbedRange } from './noteEmbedEditing';

export type NoteEmbedBlockReason = 'missing-note' | 'missing-heading' | 'range-changed';

export interface NoteEmbedReplica {
  open(path: string): Promise<{ text: string; version: number }>;
  read(path: string): Promise<{ text: string; version: number }>;
  release(path: string): Promise<void>;
  push(path: string, version: number, client: string, changes: unknown[]): Promise<boolean>;
  pull(path: string, version: number): Promise<PullResult>;
  onChange(path: string, handler: () => void): () => void;
}

export interface NoteEmbedSessionOptions {
  path: string;
  heading: string | null;
  clientId: string;
  replica: NoteEmbedReplica;
  onText: (text: string) => void;
  onBlocked: (reason: NoteEmbedBlockReason) => void;
}

export class NoteEmbedSession {
  private readonly options: NoteEmbedSessionOptions;
  private source = Text.empty;
  private version = 0;
  private range: NoteEmbedRange | null = null;
  private pending = 0;
  private generation = 0;
  private blocked = false;
  private started = false;
  private released = false;
  private chain: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;

  constructor(options: NoteEmbedSessionOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    const { replica, path } = this.options;
    let opened: { text: string; version: number };
    try {
      opened = await replica.open(path);
    } catch {
      this.block('missing-note');
      return;
    }
    this.source = Text.of(opened.text.split('\n'));
    this.version = opened.version;
    this.started = true;
    if (!this.recomputeRange()) {
      await this.release();
      return;
    }
    this.unsubscribe = replica.onChange(path, () => this.enqueue(() => this.sync()));
    this.options.onText(this.slice());
  }

  applyLocal(changes: ChangeSet): void {
    if (!this.started || this.blocked || changes.empty) return;
    const range = this.range;
    if (!range) return;
    const full = localChange(changes, range, this.source);
    const base = this.version;
    this.source = full.apply(this.source);
    this.version += 1;
    this.pending += 1;
    const generation = this.generation;
    this.enqueue(async () => {
      let accepted = false;
      try {
        accepted = await this.options.replica.push(this.options.path, base, this.options.clientId, [full.toJSON()]);
      } catch {
        accepted = false;
      }
      if (generation !== this.generation) return;
      this.pending -= 1;
      if (!accepted) {
        await this.reset();
        return;
      }
      if (this.recomputeRange()) this.options.onText(this.slice());
      if (this.pending === 0) await this.sync();
    });
  }

  destroy(): void {
    this.generation += 1;
    this.pending = 0;
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    void this.release();
  }

  private async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    await this.options.replica.release(this.options.path).catch(() => {});
  }

  private async sync(): Promise<void> {
    if (!this.started || this.blocked || this.pending > 0) return;
    const version = this.version;
    let result: PullResult;
    try {
      result = await this.options.replica.pull(this.options.path, version);
    } catch {
      return;
    }
    if (!this.started || this.version !== version) return;
    if (result.kind === 'resync') {
      this.source = Text.of(result.text.split('\n'));
      this.version = result.version;
      this.pending = 0;
      this.generation += 1;
      if (this.recomputeRange()) this.options.onText(this.slice());
      return;
    }
    let foreign = false;
    for (const entry of result.changes) {
      const changeSet = ChangeSet.fromJSON(entry.changes);
      if (!this.range) return;
      if (entry.client !== this.options.clientId && this.crosses(changeSet, this.range)) {
        this.block('range-changed');
        return;
      }
      this.source = changeSet.apply(this.source);
      this.version += 1;
      if (entry.client !== this.options.clientId) foreign = true;
    }
    const available = this.recomputeRange();
    if (foreign || !available) this.options.onText(this.slice());
  }

  private async reset(): Promise<void> {
    this.generation += 1;
    this.pending = 0;
    let opened: { text: string; version: number };
    try {
      opened = await this.options.replica.read(this.options.path);
    } catch {
      this.block('missing-note');
      return;
    }
    this.source = Text.of(opened.text.split('\n'));
    this.version = opened.version;
    if (this.recomputeRange()) this.options.onText(this.slice());
  }

  private recomputeRange(): boolean {
    this.range = noteEmbedBodyRange(this.source, this.options.heading);
    if (this.range) return true;
    this.block('missing-heading');
    return false;
  }

  private block(reason: NoteEmbedBlockReason): void {
    this.blocked = true;
    this.options.onBlocked(reason);
  }

  private crosses(changes: ChangeSet, range: NoteEmbedRange): boolean {
    let crossed = false;
    changes.iterChanges((fromA, toA) => {
      if (fromA < range.from && range.from < toA) crossed = true;
      if (fromA < range.to && range.to < toA) crossed = true;
    });
    return crossed;
  }

  private slice(): string {
    return this.range ? this.source.sliceString(this.range.from, this.range.to) : '';
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch(() => {});
  }
}
