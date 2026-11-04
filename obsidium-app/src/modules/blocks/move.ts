import {
  blocksInRanges,
  isContainer,
  scanBlocks,
  subtreeEnd,
  type BlockInfo,
  type BlockRange,
  type TextChange,
} from './model';

export type DropMode = 'before' | 'after' | 'inside';

export interface DropTarget {
  mode: DropMode;
  block: BlockInfo;
}

interface Removal {
  from: number;
  to: number;
}

export function blockSelection(source: string, ranges: readonly BlockRange[]): BlockInfo[] {
  const blocks = scanBlocks(source);
  const roots = blocksInRanges(source, ranges);
  const selected = new Map<number, BlockInfo>();
  for (const root of roots) {
    if (!selected.has(root.from)) selected.set(root.from, root);
    if (root.kind !== 'listItem') continue;
    const index = blocks.findIndex((block) => block.from === root.from);
    for (let child = index + 1; child <= subtreeEnd(blocks, index); child += 1) {
      selected.set(blocks[child]!.from, blocks[child]!);
    }
  }
  return [...selected.values()].sort((a, b) => a.from - b.from);
}

function removalRanges(source: string, selection: readonly BlockInfo[]): Removal[] {
  const removals: Removal[] = [];
  for (const block of selection) {
    let from = block.from;
    let to = block.to;
    if (source[to] === '\n') {
      to += 1;
      if (source[to] === '\n') to += 1;
    } else {
      if (from > 0 && source[from - 1] === '\n') from -= 1;
      if (from > 0 && source[from - 1] === '\n') from -= 1;
    }
    removals.push({ from, to });
  }
  return removals.sort((a, b) => a.from - b.from);
}

function applyRemovals(source: string, removals: readonly Removal[]): string {
  let mutated = source;
  for (const removal of [...removals].sort((a, b) => b.from - a.from)) {
    mutated = mutated.slice(0, removal.from) + mutated.slice(removal.to);
  }
  return mutated;
}

function mapIntoMutated(offset: number, removals: readonly Removal[]): number {
  let result = offset;
  for (const removal of removals) {
    if (removal.to <= result) result -= removal.to - removal.from;
    else if (removal.from < result) return removal.from;
  }
  return result;
}

function containerEnd(blocks: readonly BlockInfo[], block: BlockInfo): number {
  const index = blocks.findIndex((entry) => entry.from === block.from);
  if (index < 0) return block.to;
  if (block.kind === 'listItem') return blocks[subtreeEnd(blocks, index)]!.to;
  let last = index;
  while (last + 1 < blocks.length && blocks[last + 1]!.kind === block.kind) last += 1;
  return blocks[last]!.to;
}

function indentInto(container: BlockInfo, text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (container.kind === 'listItem') return line.trim() ? `  ${line}` : line;
      return line.trim() ? `  > ${line}` : '  >';
    })
    .join('\n');
}

function minimalChange(source: string, final: string): TextChange {
  let prefix = 0;
  const maxPrefix = Math.min(source.length, final.length);
  while (prefix < maxPrefix && source[prefix] === final[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < source.length - prefix
    && suffix < final.length - prefix
    && source[source.length - 1 - suffix] === final[final.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    from: prefix,
    to: source.length - suffix,
    insert: final.slice(prefix, final.length - suffix),
  };
}

function joinBlocks(selection: readonly BlockInfo[]): string {
  const separatorFor = (block: BlockInfo): string => (block.kind === 'listItem' ? '\n' : '\n\n');
  return selection
    .map((block) => block.text)
    .reduce((acc, text, index) => (index === 0 ? text : `${acc}${separatorFor(selection[index - 1]!)}${text}`), '');
}

export function moveBlocks(
  source: string,
  ranges: readonly BlockRange[],
  drop: DropTarget,
): TextChange | null {
  const selection = blockSelection(source, ranges);
  if (!selection.length) return null;
  if (drop.mode === 'inside' && !isContainer(drop.block)) return null;
  if (selection.some((block) => drop.block.from >= block.from && drop.block.to <= block.to)) {
    return null;
  }

  const blocks = scanBlocks(source);
  if (drop.block.kind === 'listItem') {
    const subtreeTo = containerEnd(blocks, drop.block);
    if (selection.some((block) => block.from >= drop.block.from && block.to <= subtreeTo)) {
      return null;
    }
  }

  const moved = joinBlocks(selection);
  const removals = removalRanges(source, selection);
  const mutated = applyRemovals(source, removals);
  const listTarget = drop.block.kind === 'listItem';

  if (drop.mode === 'inside') {
    const end = containerEnd(blocks, drop.block);
    const insertAt = mapIntoMutated(end, removals);
    return minimalChange(
      source,
      mutated.slice(0, insertAt) + `\n${indentInto(drop.block, moved)}` + mutated.slice(insertAt),
    );
  }

  if (drop.mode === 'before') {
    const insertAt = mapIntoMutated(drop.block.from, removals);
    const lead = insertAt > 0 && mutated[insertAt - 1] !== '\n' ? '\n' : '';
    const tail = listTarget ? '\n' : '\n\n';
    return minimalChange(
      source,
      mutated.slice(0, insertAt) + `${lead}${moved}${tail}` + mutated.slice(insertAt),
    );
  }

  const insertAt = mapIntoMutated(drop.block.to, removals);
  const lead = listTarget ? '\n' : '\n\n';
  const tail = insertAt < mutated.length && mutated[insertAt] !== '\n' ? '\n' : '';
  return minimalChange(
    source,
    mutated.slice(0, insertAt) + `${lead}${moved}${tail}` + mutated.slice(insertAt),
  );
}
export function duplicateBlocks(
  source: string,
  ranges: readonly BlockRange[],
): TextChange | null {
  const selection = blockSelection(source, ranges);
  if (!selection.length) return null;
  const last = selection[selection.length - 1]!;
  const text = joinBlocks(selection);
  return { from: last.to, to: last.to, insert: `\n${text}` };
}

export function deleteBlocks(
  source: string,
  ranges: readonly BlockRange[],
): TextChange | null {
  const selection = blockSelection(source, ranges);
  if (!selection.length) return null;
  const removals = removalRanges(source, selection);
  return {
    from: removals[0]!.from,
    to: removals[removals.length - 1]!.to,
    insert: '',
  };
}
