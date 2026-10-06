import type { LineHunk } from './lineDiff';
import type { TextEdit } from './textDiff';

function lineOffsets(lines: string[]): number[] {
  const offsets = new Array<number>(lines.length + 1);
  let position = 0;
  for (let index = 0; index < lines.length; index += 1) {
    offsets[index] = position;
    position += lines[index].length + 1;
  }
  offsets[lines.length] = position;
  return offsets;
}

function terminatedEdits(offsets: number[], hunks: LineHunk[]): TextEdit[] {
  return hunks.map((hunk) => ({
    from: offsets[hunk.from],
    to: offsets[hunk.to],
    insert: hunk.lines.map((line) => `${line}\n`).join(''),
  }));
}

function withoutTerminator(edit: TextEdit, textLength: number): TextEdit {
  if (edit.to <= textLength) return edit;
  if (edit.from > textLength) {
    return {
      from: textLength,
      to: textLength,
      insert: edit.insert.length > 0 ? `\n${edit.insert.slice(0, -1)}` : '',
    };
  }
  if (edit.insert.length > 0) {
    return { from: edit.from, to: textLength, insert: edit.insert.slice(0, -1) };
  }
  return { from: Math.max(0, edit.from - 1), to: textLength, insert: '' };
}

function withTailJoined(edits: TextEdit[], text: string): TextEdit[] {
  if (edits.length < 2) return edits;
  const tail = edits[edits.length - 1];
  const ahead = edits[edits.length - 2];
  if (tail.from > ahead.to) return edits;

  const overlap = ahead.to - tail.from;
  const bridged = overlap > 0
    ? ahead.insert.slice(0, Math.max(0, ahead.insert.length - overlap))
    : ahead.insert + text.slice(ahead.to, tail.from);
  return [
    ...edits.slice(0, -2),
    { from: ahead.from, to: Math.max(ahead.to, tail.to), insert: bridged + tail.insert },
  ];
}

export function toCharEdits(lines: string[], hunks: LineHunk[]): TextEdit[] {
  if (hunks.length === 0) return [];
  const text = lines.join('\n');
  const edits = terminatedEdits(lineOffsets(lines), hunks);
  edits[edits.length - 1] = withoutTerminator(edits[edits.length - 1], text.length);
  return withTailJoined(edits, text);
}
