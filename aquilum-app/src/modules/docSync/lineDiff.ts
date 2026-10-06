export interface LineHunk {
  from: number;
  to: number;
  lines: string[];
}

interface LineDiff {
  hunks: LineHunk[];
  coarse: boolean;
}

export const COARSE_MERGE_THRESHOLD = 1000;

export function splitLines(text: string): string[] {
  return text.split('\n');
}

function commonSubsequenceTable(left: string[], right: string[]): Int32Array[] {
  const table: Int32Array[] = Array.from(
    { length: left.length + 1 },
    () => new Int32Array(right.length + 1),
  );
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      table[row][column] = left[row] === right[column]
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }
  return table;
}

function alignedHunks(base: string[], next: string[], offset: number): LineHunk[] {
  const table = commonSubsequenceTable(base, next);
  const hunks: LineHunk[] = [];
  let baseIndex = 0;
  let nextIndex = 0;
  let open: LineHunk | null = null;

  const openHunk = (): LineHunk => {
    if (!open) open = { from: offset + baseIndex, to: offset + baseIndex, lines: [] };
    return open;
  };
  const closeHunk = () => {
    if (open) hunks.push(open);
    open = null;
  };

  while (baseIndex < base.length && nextIndex < next.length) {
    if (base[baseIndex] === next[nextIndex]) {
      closeHunk();
      baseIndex += 1;
      nextIndex += 1;
    } else if (table[baseIndex + 1][nextIndex] >= table[baseIndex][nextIndex + 1]) {
      openHunk().to = offset + baseIndex + 1;
      baseIndex += 1;
    } else {
      openHunk().lines.push(next[nextIndex]);
      nextIndex += 1;
    }
  }
  if (baseIndex < base.length) openHunk().to = offset + base.length;
  if (nextIndex < next.length) openHunk().lines.push(...next.slice(nextIndex));
  closeHunk();
  return hunks;
}

export function lineDiff(base: string[], next: string[]): LineDiff {
  const limit = Math.min(base.length, next.length);
  let head = 0;
  while (head < limit && base[head] === next[head]) head += 1;
  let tail = 0;
  while (
    tail < limit - head
    && base[base.length - 1 - tail] === next[next.length - 1 - tail]
  ) {
    tail += 1;
  }

  const baseMiddle = base.slice(head, base.length - tail);
  const nextMiddle = next.slice(head, next.length - tail);
  if (baseMiddle.length === 0 && nextMiddle.length === 0) {
    return { hunks: [], coarse: false };
  }
  if (
    baseMiddle.length > COARSE_MERGE_THRESHOLD
    || nextMiddle.length > COARSE_MERGE_THRESHOLD
  ) {
    return {
      hunks: [{ from: head, to: base.length - tail, lines: nextMiddle }],
      coarse: true,
    };
  }
  return { hunks: alignedHunks(baseMiddle, nextMiddle, head), coarse: false };
}

export function applyHunks(
  base: string[],
  hunks: LineHunk[],
  from = 0,
  to = base.length,
): string[] {
  const result: string[] = [];
  let cursor = from;
  for (const hunk of hunks) {
    result.push(...base.slice(cursor, hunk.from));
    result.push(...hunk.lines);
    cursor = hunk.to;
  }
  result.push(...base.slice(cursor, to));
  return result;
}
