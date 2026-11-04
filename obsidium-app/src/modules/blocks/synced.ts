import type { BlockRange, TextChange } from './model';

export interface SyncRegion {
  id: string;
  from: number;
  to: number;
  content: string;
}

const OPEN_PATTERN = /^ {0,3}<!--\s*obsidium-sync:([A-Za-z0-9_-]+)\s*-->\s*$/;
const CLOSE_PATTERN = /^ {0,3}<!--\s*\/obsidium-sync\s*-->\s*$/;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

interface LineSpan {
  from: number;
  text: string;
}

function splitLinesWithOffsets(source: string): LineSpan[] {
  const lines: LineSpan[] = [];
  let from = 0;
  while (from <= source.length) {
    const next = source.indexOf('\n', from);
    if (next === -1) {
      lines.push({ from, text: source.slice(from) });
      break;
    }
    lines.push({ from, text: source.slice(from, next) });
    from = next + 1;
  }
  return lines;
}

export function parseSyncRegions(source: string): SyncRegion[] {
  const lines = splitLinesWithOffsets(source);
  const regions: SyncRegion[] = [];
  let index = 0;
  while (index < lines.length) {
    const open = OPEN_PATTERN.exec(lines[index]!.text);
    if (!open) {
      index += 1;
      continue;
    }
    const id = open[1]!;
    const regionFrom = lines[index]!.from;
    const contentFrom = index + 1 < lines.length ? lines[index + 1]!.from : source.length;
    let close: LineSpan | null = null;
    let scan = index + 1;
    while (scan < lines.length) {
      const text = lines[scan]!.text;
      if (CLOSE_PATTERN.test(text)) {
        close = lines[scan]!;
        break;
      }
      if (OPEN_PATTERN.test(text)) break;
      scan += 1;
    }
    if (!close) {
      index += 1;
      continue;
    }
    const to = close.from + close.text.length;
    const contentEnd = contentFrom < close.from && source[close.from - 1] === '\n' ? close.from - 1 : close.from;
    regions.push({ id, from: regionFrom, to, content: source.slice(contentFrom, contentEnd) });
    index = scan + 1;
  }
  return regions;
}

export function syncRegion(source: string, id: string): SyncRegion | null {
  const matches = parseSyncRegions(source).filter((region) => region.id === id);
  return matches.length === 1 ? matches[0]! : null;
}

export function syncRegionAt(source: string, position: number): SyncRegion | null {
  const regions = parseSyncRegions(source);
  return regions.find((region) => position >= region.from && position <= region.to) ?? null;
}

export function syncedRegionText(id: string, content: string): string {
  return `<!-- obsidium-sync:${id} -->\n${content.replace(/\n+$/, '')}\n<!-- /obsidium-sync -->`;
}

export function replaceSyncRegion(source: string, id: string, content: string): string | null {
  if (!ID_PATTERN.test(id)) return null;
  const region = syncRegion(source, id);
  if (!region) return null;
  return source.slice(0, region.from) + syncedRegionText(id, content) + source.slice(region.to);
}

export function removeSyncRegion(source: string, id: string): string | null {
  if (!ID_PATTERN.test(id)) return null;
  const region = syncRegion(source, id);
  if (!region) return null;
  return source.slice(0, region.from) + region.content + source.slice(region.to);
}

export function wrapInSyncRegion(source: string, ranges: readonly BlockRange[], id: string): TextChange | null {
  if (!ID_PATTERN.test(id) || ranges.length === 0) return null;
  const from = ranges[0]!.from;
  const to = ranges[ranges.length - 1]!.to;
  if (to < from || from < 0 || to > source.length) return null;
  const content = source.slice(from, to);
  if (content.trim() === '') return null;
  return { from, to, insert: syncedRegionText(id, content) };
}

export function newSyncedId(): string {
  return `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const SYNC_OPEN_LINE_PATTERN = OPEN_PATTERN;
export const SYNC_CLOSE_LINE_PATTERN = CLOSE_PATTERN;
export const SYNC_ID_PATTERN = ID_PATTERN;
