/** Move a complete Markdown list branch, keeping its children and continuation lines. */
export interface OutlineMove {
  from: number;
  to: number;
  insert: string;
  caret: number;
}

interface OutlineEntry { indent: number }

function indentation(text: string): number {
  let level = 0;
  for (const char of /^[ \t]*/.exec(text)?.[0] ?? '') {
    level += char === '\t' ? 4 - level % 4 : 1;
  }
  return level;
}

function entry(text: string): OutlineEntry | null {
  return /^[ \t]*(?:[-+*]|\d+[.)])\s/.test(text) ? { indent: indentation(text) } : null;
}

function subtreeEnd(lines: readonly string[], first: number, limit: number): number {
  const original = entry(lines[first]);
  if (!original) return first + 1;
  for (let line = first + 1; line < limit; line += 1) {
    const text = lines[line];
    if (!text.trim()) continue;
    const candidate = entry(text);
    if (candidate && candidate.indent <= original.indent) return line;
    if (!candidate && indentation(text) <= original.indent) return line;
  }
  return limit;
}

export function outlineChildRange(source: string, lineNumber: number): { from: number; to: number } | null {
  const lines = source.split('\n');
  const limit = lines.length - (source.endsWith('\n') ? 1 : 0);
  const start = lineNumber - 1;
  if (start < 0 || start >= limit || !entry(lines[start])) return null;
  const end = subtreeEnd(lines, start, limit);
  if (end <= start + 1) return null;
  const from = lines.slice(0, start + 1).join('\n').length;
  const to = lines.slice(0, end).join('\n').length;
  return { from, to };
}

export function moveOutlineSubtree(
  source: string,
  caret: number,
  direction: 'up' | 'down',
): OutlineMove | null {
  if (caret < 0 || caret > source.length) return null;
  const lines = source.split('\n');
  const limit = lines.length - (source.endsWith('\n') ? 1 : 0);
  const offsets: number[] = [];
  let position = 0;
  for (const line of lines) {
    offsets.push(position);
    position += line.length + 1;
  }
  let current = 0;
  for (; current < limit - 1 && offsets[current + 1] <= caret; current += 1) {}
  const active = entry(lines[current]);
  if (!active) return null;
  const currentEnd = subtreeEnd(lines, current, limit);
  let first: number;
  let middle: number;
  let last: number;
  if (direction === 'up') {
    let previous = current - 1;
    for (; previous >= 0; previous -= 1) {
      const item = entry(lines[previous]);
      if (!item) {
        if (lines[previous].trim() && indentation(lines[previous]) <= active.indent) return null;
        continue;
      }
      if (item.indent < active.indent) return null;
      if (item.indent === active.indent) break;
    }
    if (previous < 0 || subtreeEnd(lines, previous, limit) !== current) return null;
    [first, middle, last] = [previous, current, currentEnd];
  } else {
    if (currentEnd >= limit || entry(lines[currentEnd])?.indent !== active.indent) return null;
    [first, middle, last] = [current, currentEnd, subtreeEnd(lines, currentEnd, limit)];
  }
  const firstRows = lines.slice(first, middle);
  const secondRows = lines.slice(middle, last);
  const swapped = secondRows.concat(firstRows);
  const from = offsets[first];
  const to = last === limit ? source.length : offsets[last];
  const suffix = last < limit || source.endsWith('\n') ? '\n' : '';
  const insert = swapped.join('\n') + suffix;
  const newStartOffset = from + (direction === 'up'
    ? 0
    : secondRows.join('\n').length + 1);
  const caretInCurrent = caret - offsets[current];
  return { from, to, insert, caret: newStartOffset + caretInCurrent };
}
