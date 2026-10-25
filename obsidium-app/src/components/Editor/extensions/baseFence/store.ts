import type { BaseDefinition, BaseEvaluation } from '../../../../modules/bases';
import { comparablePath } from '../../../../modules/paths';
import { MAX_CACHED_FENCES_PER_NOTE, MAX_CACHED_NOTES, UNKNOWN_HEIGHT } from './constants';

export type BaseFenceResult =
  | {
    status: 'ready';
    definition: BaseDefinition;
    evaluation: BaseEvaluation;
    viewIndex: number;
  }
  | { status: 'failed'; message: string };

type FenceState = {
  result: BaseFenceResult | null;
  signature: string;
  revision: number;
  height: number;
};

const notes = new Map<string, Map<string, FenceState>>();
const revisions = new Map<string, number>();

export function baseFenceCacheNoteKey(workspacePath: string, notePath: string): string {
  return `${workspacePath}\0${notePath}`;
}

export function baseFenceKey(basePath: string, view: string | null): string {
  return `${comparablePath(basePath)}\0${view ?? ''}`;
}

export function baseFenceRevision(workspacePath: string): number {
  return revisions.get(comparablePath(workspacePath)) ?? 0;
}

export function bumpBaseFenceRevision(workspacePath: string): number {
  const key = comparablePath(workspacePath);
  const next = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, next);
  return next;
}

function noteStates(cacheNotePath: string): Map<string, FenceState> {
  const known = notes.get(cacheNotePath);
  if (known) {
    notes.delete(cacheNotePath);
    notes.set(cacheNotePath, known);
    return known;
  }
  const created = new Map<string, FenceState>();
  notes.set(cacheNotePath, created);
  for (const oldest of notes.keys()) {
    if (notes.size <= MAX_CACHED_NOTES) break;
    notes.delete(oldest);
  }
  return created;
}

function stateOf(cacheNotePath: string, key: string): FenceState | undefined {
  const states = notes.get(cacheNotePath);
  const known = states?.get(key);
  if (known && states) {
    states.delete(key);
    states.set(key, known);
  }
  return known;
}

function writableState(cacheNotePath: string, key: string): FenceState {
  const states = noteStates(cacheNotePath);
  const known = stateOf(cacheNotePath, key);
  if (known) return known;
  const created: FenceState = { result: null, signature: '', revision: -1, height: UNKNOWN_HEIGHT };
  states.set(key, created);
  while (states.size > MAX_CACHED_FENCES_PER_NOTE) {
    const oldest = states.keys().next().value;
    if (oldest === undefined) break;
    states.delete(oldest);
  }
  return created;
}

export function cachedBaseFenceResult(
  cacheNotePath: string,
  key: string,
  revision: number,
): BaseFenceResult | undefined {
  const state = stateOf(cacheNotePath, key);
  if (!state || state.revision < revision) return undefined;
  return state.result ?? undefined;
}

export function baseFenceResultSignature(
  cacheNotePath: string,
  key: string,
  revision: number,
): string {
  const state = stateOf(cacheNotePath, key);
  if (!state || state.revision < revision) return '';
  return state.signature;
}

export function baseFenceBlockHeight(cacheNotePath: string, key: string): number {
  return stateOf(cacheNotePath, key)?.height ?? UNKNOWN_HEIGHT;
}

export function rememberBaseFenceBlockHeight(
  cacheNotePath: string,
  key: string,
  height: number,
): void {
  if (height <= 0) return;
  const state = stateOf(cacheNotePath, key);
  if (!state || state.height === height) return;
  state.height = height;
}

export function rememberBaseFenceResult(
  cacheNotePath: string,
  key: string,
  revision: number,
  result: BaseFenceResult,
): boolean {
  const state = writableState(cacheNotePath, key);
  const next = signature(result);
  const changed = state.revision !== revision || state.result === null || state.signature !== next;
  state.result = result;
  state.signature = next;
  state.revision = revision;
  return changed;
}

export function forgetBaseFencesOutside(cacheNotePath: string, keys: Set<string>): void {
  const states = noteStates(cacheNotePath);
  for (const key of states.keys()) {
    if (!keys.has(key)) states.delete(key);
  }
}

function signature(result: BaseFenceResult): string {
  if (result.status === 'failed') return `failed\0${result.message}`;
  const { evaluation } = result;
  return [
    'ready',
    result.viewIndex,
    evaluation.columns.join('\u0000'),
    evaluation.rows
      .map((row) => `${row.path}\u0001${JSON.stringify(row.fields)}`)
      .join('\u0002'),
    evaluation.groups.map((group) => `${group.label ?? ''}:${group.start}:${group.end}`).join('\u0002'),
    evaluation.unsupported,
    evaluation.errors.map((error) => `${error.formula}:${error.path}:${error.message}`).join('\u0002'),
  ].join('\u0003');
}
