import { clamp } from '../math';

export interface TextEdit {
  from: number;
  to: number;
  insert: string;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

export function applyEditsToText(text: string, edits: readonly TextEdit[]): string {
  return [...edits]
    .sort((left, right) => right.from - left.from)
    .reduce((result, edit) => result.slice(0, edit.from) + edit.insert + result.slice(edit.to), text);
}

export function diffText(previous: string, next: string): TextEdit | null {
  if (previous === next) return null;

  const limit = Math.min(previous.length, next.length);
  let prefix = 0;
  while (prefix < limit && previous.charCodeAt(prefix) === next.charCodeAt(prefix)) {
    prefix += 1;
  }
  if (prefix > 0 && isHighSurrogate(previous.charCodeAt(prefix - 1))) prefix -= 1;

  const suffixLimit = limit - prefix;
  let suffix = 0;
  while (
    suffix < suffixLimit
    && previous.charCodeAt(previous.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  if (suffix > 0 && isLowSurrogate(previous.charCodeAt(previous.length - suffix))) suffix -= 1;

  return {
    from: prefix,
    to: previous.length - suffix,
    insert: next.slice(prefix, next.length - suffix),
  };
}

function lineStart(text: string, line: number): number {
  let start = 0;
  for (let index = 0; index < line; index += 1) {
    const next = text.indexOf('\n', start);
    if (next === -1) return -1;
    start = next + 1;
  }
  return start;
}

function lineEnd(text: string, start: number): number {
  const next = text.indexOf('\n', start);
  return next === -1 ? text.length : next;
}

export function caretAtSameLine(previous: string, next: string, position: number): number {
  const clamped = clamp(position, 0, previous.length);
  const line = previous.slice(0, clamped).split('\n').length - 1;
  const column = clamped - lineStart(previous, line);

  const start = lineStart(next, line);
  if (start === -1) return next.length;
  return Math.min(start + column, lineEnd(next, start));
}
