const BLOCK_ID = /^[A-Za-z0-9-]+$/;
const LIST_ITEM = /^(?:[-*+]|\d+[.)]) /;
const HEADING = /^\s*#{1,6} /;

export function blockOffset(content: string, blockId: string): number | null {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const starts: number[] = [];
  let start = 0;
  for (const line of lines) {
    starts.push(start);
    start += line.length + 1;
  }
  const visible = visibleLines(lines);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!visible[index] || marker(line) !== blockId) continue;
    if (HEADING.test(line) || !endsBlock(lines, visible, index)) continue;
    return starts[blockStart(lines, visible, index)]!;
  }
  return null;
}

function visibleLines(lines: string[]): boolean[] {
  const visible = lines.map(() => false);
  let fence: { marker: string; length: number } | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const opening = lines[index]!.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (opening?.[1]?.[0] === fence.marker && opening[1].length >= fence.length) fence = null;
      continue;
    }
    if (opening) {
      fence = { marker: opening[1]![0]!, length: opening[1]!.length };
      continue;
    }
    visible[index] = true;
  }
  return visible;
}

function marker(line: string): string | null {
  const trimmed = line.replace(/\s+$/, '');
  const at = trimmed.lastIndexOf('^');
  if (at <= 0 || !/\s/.test(trimmed[at - 1]!)) return null;
  if (openCodeSpan(trimmed.slice(0, at))) return null;
  const id = trimmed.slice(at + 1);
  return BLOCK_ID.test(id) ? id : null;
}

function openCodeSpan(prefix: string): boolean {
  let runs = 0;
  let index = 0;
  while (index < prefix.length) {
    if (prefix[index] === '`') {
      runs += 1;
      while (prefix[index] === '`') index += 1;
    } else {
      index += 1;
    }
  }
  return runs % 2 === 1;
}

function endsBlock(lines: string[], visible: boolean[], index: number): boolean {
  if (index + 1 >= lines.length) return true;
  const next = lines[index + 1]!;
  if (!next.trim() || !visible[index + 1] || HEADING.test(next)) return true;
  return LIST_ITEM.test(lines[index]!) && !/^[ \t]/.test(next);
}

function blockStart(lines: string[], visible: boolean[], index: number): number {
  if (LIST_ITEM.test(lines[index]!)) return index;
  let start = index;
  while (start > 0 && visible[start - 1] && lines[start - 1]!.trim()) {
    if (HEADING.test(lines[start - 1]!)) break;
    start -= 1;
    if (LIST_ITEM.test(lines[start]!)) break;
  }
  return start;
}
