import { MAX_CACHED_DIAGRAMS, UNKNOWN_DIAGRAM_HEIGHT } from './constants';

export type DiagramResult =
  | { status: 'ready'; svg: string }
  | { status: 'failed'; message: string };

interface DiagramEntry {
  result: DiagramResult | null;
  height: number;
}

const entries = new Map<string, DiagramEntry>();

export function diagramKey(source: string, themeKey: string): string {
  return `${themeKey}\u0000${source}`;
}

function entryOf(key: string): DiagramEntry | undefined {
  const known = entries.get(key);
  if (known) {
    entries.delete(key);
    entries.set(key, known);
  }
  return known;
}

export function cachedDiagram(key: string): DiagramResult | undefined {
  return entryOf(key)?.result ?? undefined;
}

export function diagramHeight(key: string): number {
  return entryOf(key)?.height ?? UNKNOWN_DIAGRAM_HEIGHT;
}

export function rememberDiagramHeight(key: string, height: number): void {
  if (height <= 0) return;
  const entry = entryOf(key);
  if (!entry || entry.height === height) return;
  entry.height = height;
}

export function rememberDiagramResult(key: string, result: DiagramResult): boolean {
  const known = entryOf(key);
  const changed = !known?.result
    || known.result.status !== result.status
    || (result.status === 'ready' && known.result.status === 'ready' && known.result.svg !== result.svg)
    || (result.status === 'failed' && known.result.status === 'failed' && known.result.message !== result.message);

  if (known) {
    known.result = result;
    entries.delete(key);
    entries.set(key, known);
  } else {
    entries.set(key, { result, height: UNKNOWN_DIAGRAM_HEIGHT });
  }
  while (entries.size > MAX_CACHED_DIAGRAMS) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return changed;
}

export function forgetDiagramsOutside(keys: Set<string>): void {
  for (const key of entries.keys()) {
    if (!keys.has(key)) entries.delete(key);
  }
}
