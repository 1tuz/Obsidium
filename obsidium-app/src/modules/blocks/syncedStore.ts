import { invoke } from '@tauri-apps/api/core';
import type { EditorView } from '@codemirror/view';
import {
  parseSyncRegions,
  removeSyncRegion,
  newSyncedId,
  wrapInSyncRegion,
  type SyncRegion,
} from './synced';
import type { BlockRange } from './model';
import { isDocumentMissing, rewriteDocument } from '../documents/documentGateway';

export interface SyncedBlockRecord {
  id: string;
  content: string;
  revision: number;
  sourcePath: string;
  updatedAt: number;
}

type SyncedListener = (record: SyncedBlockRecord) => void;


const records = new Map<string, SyncedBlockRecord>();
const listeners = new Map<string, Set<SyncedListener>>();
const instances = new Map<string, Set<string>>();
const lastSeenRevisions = new WeakMap<EditorView, Map<string, number>>();

let loaded = false;
let loadPromise: Promise<void> | null = null;
let writeQueued = false;
let pathProvider: (() => string | null) | null = null;

const WRITE_DEBOUNCE_MS = 120;

export function setSyncedPathProvider(provider: () => string | null): void {
  pathProvider = provider;
}

export async function ensureSyncedLoaded(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const text = await invoke<string>('synced_blocks_read');
      if (text) hydrate(text);
    } catch (error) {
      console.error('Failed to read synced blocks store', error);
    }
    loaded = true;
  })();
  return loadPromise;
}

function hydrate(text: string): void {
  try {
    const parsed = JSON.parse(text) as Record<string, Partial<SyncedBlockRecord>>;
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value?.content !== 'string') continue;
      records.set(id, {
        id,
        content: value.content,
        revision: typeof value.revision === 'number' ? value.revision : 1,
        sourcePath: typeof value.sourcePath === 'string' ? value.sourcePath : '',
        updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
      });
    }
  } catch (error) {
    console.error('Failed to parse synced blocks store', error);
  }
}

function serialize(): string {
  const payload: Record<string, { content: string; revision: number; sourcePath: string; updatedAt: number }> = {};
  for (const record of records.values()) {
    payload[record.id] = {
      content: record.content,
      revision: record.revision,
      sourcePath: record.sourcePath,
      updatedAt: record.updatedAt,
    };
  }
  return JSON.stringify(payload);
}

function queueWrite(): void {
  if (writeQueued) return;
  writeQueued = true;
  setTimeout(() => {
    writeQueued = false;
    void invoke('synced_blocks_write', { text: serialize() }).catch((error) => {
      console.error('Failed to persist synced blocks store', error);
    });
  }, WRITE_DEBOUNCE_MS);
}

function notify(id: string): void {
  const record = records.get(id);
  if (!record) return;
  const listenersForId = listeners.get(id);
  if (!listenersForId) return;
  for (const listener of listenersForId) listener(record);
}

export function getSyncedBlock(id: string): SyncedBlockRecord | null {
  return records.get(id) ?? null;
}

export async function createSyncedBlock(view: EditorView, ranges: readonly BlockRange[]): Promise<string | null> {
  await ensureSyncedLoaded();
  const source = view.state.doc.toString();
  const id = newSyncedId();
  const change = wrapInSyncRegion(source, ranges, id);
  if (!change) return null;
  const content = source.slice(change.from, change.to);
  const sourcePath = pathProvider?.() ?? '';
  records.set(id, { id, content, revision: 1, sourcePath, updatedAt: Date.now() });
  queueWrite();
  const seen = viewSeen(view);
  seen.set(id, 1);
  view.dispatch({ changes: change });
  return id;
}

function viewSeen(view: EditorView): Map<string, number> {
  let seen = lastSeenRevisions.get(view);
  if (!seen) {
    seen = new Map();
    lastSeenRevisions.set(view, seen);
  }
  return seen;
}

export function markSyncedSeen(view: EditorView, id: string, revision: number): void {
  viewSeen(view).set(id, revision);
}

export function lastSeenRevision(view: EditorView, id: string): number | null {
  return viewSeen(view).get(id) ?? null;
}

export function regionsOf(source: string): SyncRegion[] {
  return parseSyncRegions(source);
}

export async function updateSyncedBlock(id: string, content: string, authorPath: string): Promise<void> {
  await ensureSyncedLoaded();
  const record = records.get(id);
  if (!record) return;
  const revision = record.revision + 1;
  records.set(id, { ...record, content, revision, updatedAt: Date.now() });
  queueWrite();
  notify(id);
  const targets = instances.get(id) ?? new Set<string>();
  for (const path of targets) {
    if (path === authorPath) continue;
    try {
      await rewriteDocument(path, (text) => replaceRegionSafely(text, id, content));
    } catch (error) {
      if (isDocumentMissing(error)) continue;
      console.error(`Failed to rewrite synced block ${id} in ${path}`, error);
    }
  }
}

export function replaceRegionSafely(text: string, id: string, content: string): string | null {
  const regions = parseSyncRegions(text);
  const matches = regions.filter((region) => region.id === id);
  if (matches.length !== 1) return null;
  const next = text.slice(0, matches[0]!.from)
    + `<!-- obsidium-sync:${id} -->\n${content.replace(/\n+$/, '')}\n<!-- /obsidium-sync -->`
    + text.slice(matches[0]!.to);
  return next === text ? null : next;
}

export async function detachSyncedBlock(view: EditorView, id: string): Promise<void> {
  await ensureSyncedLoaded();
  const source = view.state.doc.toString();
  const regions = parseSyncRegions(source);
  const matches = regions.filter((region) => region.id === id);
  if (matches.length !== 1) return;
  const region = matches[0]!;
  const next = removeSyncRegion(source, id);
  if (next === null) return;
  view.dispatch({ changes: { from: region.from, to: region.to, insert: region.content } });
}

export function subscribeSynced(id: string, listener: (record: SyncedBlockRecord) => void): () => void {
  let set = listeners.get(id);
  if (!set) {
    set = new Set();
    listeners.set(id, set);
  }
  set.add(listener);
  const record = records.get(id);
  if (record) listener(record);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(id);
  };
}

export function registerSyncedInstances(id: string, paths: readonly string[]): void {
  const set = new Set(paths);
  instances.set(id, set);
}

export function syncedSourcePath(id: string): string | null {
  return records.get(id)?.sourcePath ?? null;
}
