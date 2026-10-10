/** Highlightr-compatible HTML marks; vault contents remain plain Markdown. */
export interface ColorMark {
  from: number;
  openTo: number;
  textTo: number;
  to: number;
  color: string;
}

export interface ColorMarkEdit {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
}

const OPEN_MARK = /<mark\s+style=(['"])background-color:\s*(#[0-9a-f]{6});?\1>/gi;
const CLOSE_MARK = '</mark>';

export function normalizeHighlightColor(color: string): string | null {
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null;
}

export function coloredMarks(source: string): ColorMark[] {
  const result: ColorMark[] = [];
  OPEN_MARK.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OPEN_MARK.exec(source)) !== null) {
    const openTo = match.index + match[0].length;
    const textTo = source.indexOf(CLOSE_MARK, openTo);
    if (textTo < 0) continue;
    const to = textTo + CLOSE_MARK.length;
    result.push({ from: match.index, openTo, textTo, to, color: match[2].toLowerCase() });
    OPEN_MARK.lastIndex = to;
  }
  return result;
}

export function colorMarkEdit(source: string, from: number, to: number, color: string): ColorMarkEdit {
  const normalized = normalizeHighlightColor(color);
  if (!normalized || from < 0 || to < from || to > source.length) {
    throw new RangeError('Invalid color or Markdown selection');
  }
  const existing = coloredMarks(source).find(mark =>
    (mark.openTo === from && mark.textTo === to) || (mark.from === from && mark.to === to),
  );
  if (existing) {
    const text = source.slice(existing.openTo, existing.textTo);
    if (existing.color === normalized) {
      return { from: existing.from, to: existing.to, insert: text,
        anchor: existing.from, head: existing.from + text.length };
    }
    const opening = `<mark style="background-color: ${normalized}">`;
    return { from: existing.from, to: existing.to, insert: opening + text + CLOSE_MARK,
      anchor: existing.from + opening.length, head: existing.from + opening.length + text.length };
  }
  const selected = source.slice(from, to);
  const opening = `<mark style="background-color: ${normalized}">`;
  return { from, to, insert: opening + selected + CLOSE_MARK,
    anchor: from + opening.length, head: from + opening.length + selected.length };
}

export function clearColorMarkEdit(source: string, from: number, to: number): ColorMarkEdit | null {
  if (from < 0 || to < from || to > source.length) return null;
  const existing = coloredMarks(source).find(mark =>
    (from >= mark.openTo && to <= mark.textTo) || (from === mark.from && to === mark.to),
  );
  if (!existing) return null;
  const text = source.slice(existing.openTo, existing.textTo);
  return { from: existing.from, to: existing.to, insert: text,
    anchor: existing.from, head: existing.from + text.length };
}
