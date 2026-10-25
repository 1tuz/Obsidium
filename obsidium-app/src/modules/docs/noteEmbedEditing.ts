import { ChangeSet, Text } from '@codemirror/state';
import type { Line } from '@codemirror/state';
import { frontmatterRange } from './frontmatter';
import { fenceStep, normalizeHeading, parseHeadingLine } from './noteEmbeds';
import type { Fence } from './noteEmbeds';

export interface NoteEmbedRange {
  from: number;
  to: number;
}

const FRONTMATTER_SCAN = 1500;

export function noteEmbedBodyRange(text: Text, heading: string | null): NoteEmbedRange | null {
  const start = bodyStart(text);
  if (heading === null) return { from: start, to: text.length };
  const found = findHeading(text, normalizeHeading(heading), start);
  if (!found) return null;
  const from = Math.min(text.line(found.line).to + 1, text.length);
  return { from, to: Math.max(from, sectionEnd(text, found.line + 1, found.depth)) };
}

export function localChange(changes: ChangeSet, range: NoteEmbedRange, source: Text): ChangeSet {
  const startsAtEnd = range.from === source.length
    && source.length > 0
    && source.sliceString(source.length - 1) !== '\n';
  const ranges: { from: number; to: number; insert: Text }[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const separator = startsAtEnd && inserted.length > 0;
    ranges.push({
      from: fromA + range.from,
      to: toA + range.from,
      insert: separator ? Text.of(['', inserted.toString()]) : inserted,
    });
  });
  return ChangeSet.of(ranges, source.length);
}

export function textChange(before: string, after: string): ChangeSet | null {
  if (before === after) return null;
  const limit = Math.min(before.length, after.length);
  let prefix = 0;
  while (prefix < limit && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1;
  let suffix = 0;
  while (
    suffix < limit - prefix
    && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) suffix += 1;
  return ChangeSet.of({
    from: prefix,
    to: before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
  }, before.length);
}

function bodyStart(text: Text): number {
  const range = frontmatterRange(text.sliceString(0, Math.min(FRONTMATTER_SCAN, text.length)));
  if (!range) return 0;
  const next = text.sliceString(range.to, Math.min(range.to + 2, text.length));
  return Math.min(range.to + (next.startsWith('\r\n') ? 2 : 1), text.length);
}

function findHeading(text: Text, expected: string, start: number): { line: number; depth: number } | null {
  return firstLine(text, text.lineAt(start).number, (line) => {
    const parsed = parseHeadingLine(line.text);
    if (!parsed || normalizeHeading(parsed.title) !== expected) return null;
    return { line: line.number, depth: parsed.depth };
  });
}

function sectionEnd(text: Text, startLine: number, depth: number): number {
  const peer = firstLine(text, startLine, (line) => {
    const parsed = parseHeadingLine(line.text);
    return parsed !== null && parsed.depth <= depth ? line.number : null;
  });
  return peer === null ? text.length : text.line(peer - 1).to;
}

function firstLine<T>(text: Text, fromLine: number, match: (line: Line) => T | null): T | null {
  let fence: Fence | null = null;
  for (let number = fromLine; number <= text.lines; number += 1) {
    const line = text.line(number);
    const step = fenceStep(fence, line.text);
    if (step !== undefined) {
      fence = step;
      continue;
    }
    const result = match(line);
    if (result !== null) return result;
  }
  return null;
}
