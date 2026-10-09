export interface MarkdownEdit {
  from: number;
  to: number;
  insert: string;
}

export interface InlineMarkdownEdit extends MarkdownEdit {
  anchor: number;
  head: number;
}

export type BlockFormat =
  | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
  | 'bullet' | 'ordered' | 'task' | 'quote';

export function inlineMarkdownEdit(
  source: string,
  from: number,
  to: number,
  marker: string,
): InlineMarkdownEdit {
  if (!marker || from < 0 || to < from || to > source.length) {
    throw new RangeError('Invalid Markdown range or marker');
  }
  const selected = source.slice(from, to);
  const len = marker.length;

  if (selected.length >= len * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const insert = selected.slice(len, -len);
    return { from, to, insert, anchor: from, head: from + insert.length };
  }
  if (from >= len && source.slice(from - len, from) === marker
      && source.slice(to, to + len) === marker) {
    return {
      from: from - len,
      to: to + len,
      insert: selected,
      anchor: from - len,
      head: from - len + selected.length,
    };
  }
  const insert = `${marker}${selected}${marker}`;
  return {
    from,
    to,
    insert,
    anchor: from + len,
    head: from + len + selected.length,
  };
}

function getLineStart(source: string, position: number): number {
  return position === 0 ? 0 : source.lastIndexOf('\n', position - 1) + 1;
}

function lineFormatParts(line: string): { indent: string; prefix: string; body: string } {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
  const content = line.slice(indent.length);
  const prefix = /^(?:#{1,6} |[-*+] \[[ xX]\] |[-*+] |\d+[.)] |> )/.exec(content)?.[0] ?? '';
  return { indent, prefix, body: content.slice(prefix.length) };
}

function desiredPrefix(format: BlockFormat, index: number): string {
  switch (format) {
    case 'h1': return '# ';
    case 'h2': return '## ';
    case 'h3': return '### ';
    case 'h4': return '#### ';
    case 'h5': return '##### ';
    case 'h6': return '###### ';
    case 'bullet': return '- ';
    case 'ordered': return `${index + 1}. `;
    case 'task': return '- [ ] ';
    case 'quote': return '> ';
  }
}

export function blockMarkdownEdits(
  source: string,
  start: number,
  end: number,
  format: BlockFormat,
): MarkdownEdit[] {
  if (start < 0 || end < start || end > source.length) {
    throw new RangeError('Invalid Markdown selection');
  }
  const from = getLineStart(source, start);
  const last = end > start ? end - 1 : end;
  const lineStarts: number[] = [];
  let cursor = from;
  while (cursor <= last) {
    lineStarts.push(cursor);
    const nextBreak = source.indexOf('\n', cursor);
    if (nextBreak < 0) break;
    cursor = nextBreak + 1;
  }
  const rows = lineStarts.map((pos, index) => {
    const nextBreak = source.indexOf('\n', pos);
    const to = nextBreak < 0 ? source.length : nextBreak;
    const text = source.slice(pos, to);
    const parts = lineFormatParts(text);
    return { pos, to, text, parts, expected: desiredPrefix(format, index) };
  });
  const alreadyFormatted = rows.every((row) => row.parts.prefix === row.expected);
  return rows.flatMap(({ pos, to, text, parts, expected }) => {
    const next = `${parts.indent}${alreadyFormatted ? '' : expected}${parts.body}`;
    return next === text ? [] : [{ from: pos, to, insert: next }];
  });
}
