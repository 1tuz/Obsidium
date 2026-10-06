import { toCharEdits } from './hunkEdits';
import { applyHunks, lineDiff, splitLines, type LineHunk } from './lineDiff';
import type { TextEdit } from './textDiff';

interface SidedHunk extends LineHunk {
  external: boolean;
}

interface MergeResult {
  edits: TextEdit[];
  displaced: string[];
  coarse: boolean;
}

function overlaps(left: LineHunk, right: LineHunk): boolean {
  return left.from < right.to && right.from < left.to;
}

function regions(hunks: SidedHunk[]): SidedHunk[][] {
  const sorted = [...hunks].sort((left, right) => left.from - right.from || left.to - right.to);
  const grouped: SidedHunk[][] = [];
  let reach = -1;
  for (const hunk of sorted) {
    if (grouped.length > 0 && hunk.from < reach) {
      grouped[grouped.length - 1].push(hunk);
      reach = Math.max(reach, hunk.to);
      continue;
    }
    grouped.push([hunk]);
    reach = hunk.to;
  }
  return grouped;
}

const NOTHING_TO_DO: MergeResult = { edits: [], displaced: [], coarse: false };

export function mergeExternalChange(base: string, disk: string, current: string): MergeResult {
  if (disk === current) return NOTHING_TO_DO;
  const baseLines = splitLines(base);
  const diskDiff = lineDiff(baseLines, splitLines(disk));
  if (diskDiff.hunks.length === 0) return NOTHING_TO_DO;
  const external = diskDiff.hunks.map((hunk): SidedHunk => ({ ...hunk, external: true }));

  const currentLines = splitLines(current);
  const localDiff = lineDiff(baseLines, currentLines);
  const local = localDiff.hunks.map((hunk): SidedHunk => ({ ...hunk, external: false }));

  const displaced: string[] = [];
  const resolved: LineHunk[] = [];

  for (const region of regions([...external, ...local])) {
    const from = Math.min(...region.map((hunk) => hunk.from));
    const to = Math.max(...region.map((hunk) => hunk.to));
    const fromExternal = region.filter((hunk) => hunk.external);
    const fromLocal = region.filter((hunk) => !hunk.external);

    if (fromExternal.length === 0) continue;
    if (fromLocal.length > 0) {
      displaced.push(...applyHunks(baseLines, fromLocal, from, to));
    }
    resolved.push({ from, to, lines: applyHunks(baseLines, fromExternal, from, to) });
  }

  const merged = applyHunks(baseLines, [
    ...resolved,
    ...local.filter((hunk) => !resolved.some((region) => overlaps(region, hunk)
      || (hunk.from >= region.from && hunk.to <= region.to))),
  ].sort((left, right) => left.from - right.from || left.to - right.to));

  return {
    edits: toCharEdits(currentLines, lineDiff(currentLines, merged).hunks),
    displaced: displaced.filter((line) => line.trim().length > 0),
    coarse: diskDiff.coarse || localDiff.coarse,
  };
}
