import type { Text } from '@codemirror/state';
import { matchOutlineItem } from '../../components/Editor/extensions/outline/constructs';
import { parseHeadingLine } from '../docs/noteEmbeds';

export type BlockKind =
  | 'frontmatter'
  | 'code'
  | 'table'
  | 'heading'
  | 'paragraph'
  | 'quote'
  | 'callout'
  | 'listItem'
  | 'hr'
  | 'sync';

export type ListKind = 'bullet' | 'ordered' | 'task';

export interface BlockInfo {
  from: number;
  to: number;
  firstLine: number;
  lastLine: number;
  kind: BlockKind;
  level: number;
  indent: string;
  marker: string | null;
  listKind: ListKind | null;
  calloutType: string | null;
  syncId: string | null;
  ref: string | null;
  text: string;
}

export interface BlockRange {
  from: number;
  to: number;
}

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const HORIZONTAL_RULE_PATTERN = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_PATTERN = /^ {0,3}>/;
const CALLOUT_PATTERN = /^ {0,3}>[ \t]*\[!([^\]]+)\][+-]?/;
const SYNC_PATTERN = /^ {0,3}<!--\s*obsidium-sync:([A-Za-z0-9_-]+)\s*-->\s*$/;
const TABLE_DELIMITER_PATTERN = /^ {0,3}\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)+\|?[ \t]*$/;
const BLOCK_REF_PATTERN = /(?:^|\s)\^([A-Za-z0-9][\w-]*)[ \t]*$/;
const INDENT_TAB_COLUMNS = 4;
const INDENT_STEP_COLUMNS = 2;

interface LineInfo {
  text: string;
  from: number;
  to: number;
}

function splitLines(source: string): LineInfo[] {
  const lines: LineInfo[] = [];
  let from = 0;
  while (from <= source.length) {
    const newline = source.indexOf('\n', from);
    const end = newline < 0 ? source.length : newline;
    const raw = source.slice(from, end);
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    lines.push({ text, from, to: from + text.length });
    if (newline < 0) break;
    from = newline + 1;
  }
  return lines;
}

function fenceStarts(line: string): { marker: string; length: number } | null {
  const match = FENCE_PATTERN.exec(line);
  if (!match) return null;
  return { marker: match[1]![0]!, length: match[1]!.length };
}

function isFenceClose(line: string, fence: { marker: string; length: number }): boolean {
  const match = FENCE_PATTERN.exec(line);
  return match !== null && match[1]![0] === fence.marker && match[1]!.length >= fence.length;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function frontmatterEnd(lines: LineInfo[]): number {
  if (lines[0]?.text.trim() !== '---') return -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]!.text.trim() === '---') return index;
  }
  return -1;
}

function blockReference(text: string): string | null {
  const lastLine = text.split('\n').filter((line) => line.trim() !== '').pop() ?? '';
  return BLOCK_REF_PATTERN.exec(lastLine)?.[1] ?? null;
}

function makeBlock(
  lines: LineInfo[],
  first: number,
  last: number,
  kind: BlockKind,
  details: Partial<Omit<BlockInfo, 'from' | 'to' | 'firstLine' | 'lastLine' | 'kind' | 'text'>> = {},
): BlockInfo {
  const from = lines[first]!.from;
  const to = lines[last]!.to;
  const text = lines.slice(first, last + 1).map((line) => line.text).join('\n');
  return {
    from,
    to,
    firstLine: first + 1,
    lastLine: last + 1,
    kind,
    level: 0,
    indent: '',
    marker: null,
    listKind: null,
    calloutType: null,
    syncId: null,
    ref: blockReference(text),
    text,
    ...details,
  };
}

function indentDepth(indent: string): number {
  let columns = 0;
  for (const character of indent) {
    columns += character === '\t' ? INDENT_TAB_COLUMNS : 1;
  }
  return Math.ceil(columns / INDENT_STEP_COLUMNS);
}

function listDetails(line: string): { indent: string; marker: string; level: number; listKind: ListKind } | null {
  const item = matchOutlineItem(line);
  if (!item) return null;
  const content = line.slice(item.contentFrom);
  const task = /^\[[ xX]\]\s/.test(content);
  return {
    indent: item.indent,
    marker: item.marker.text,
    level: indentDepth(item.indent) + 1,
    listKind: task ? 'task' : item.marker.kind,
  };
}

function breaksListItem(line: string): boolean {
  return parseHeadingLine(line) !== null
    || fenceStarts(line) !== null
    || QUOTE_PATTERN.test(line)
    || HORIZONTAL_RULE_PATTERN.test(line)
    || SYNC_PATTERN.test(line);
}

function startsBlock(line: string, next: string | undefined, inList: boolean): boolean {
  if (isBlank(line)) return true;
  if (fenceStarts(line) || QUOTE_PATTERN.test(line) || HORIZONTAL_RULE_PATTERN.test(line)) return true;
  if (parseHeadingLine(line)) return true;
  if (SYNC_PATTERN.test(line)) return true;
  if (listDetails(line)) return true;
  if (next !== undefined && line.includes('|') && TABLE_DELIMITER_PATTERN.test(next)) return true;
  if (inList && /^[ \t]+\S/.test(line)) return false;
  return false;
}

export function scanBlocks(source: string): BlockInfo[] {
  const lines = splitLines(source);
  const blocks: BlockInfo[] = [];
  const frontmatterTo = frontmatterEnd(lines);
  let index = 0;

  if (frontmatterTo >= 0) {
    blocks.push(makeBlock(lines, 0, frontmatterTo, 'frontmatter'));
    index = frontmatterTo + 1;
  }

  while (index < lines.length) {
    const line = lines[index]!.text;
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    const fence = fenceStarts(line);
    if (fence) {
      let end = index + 1;
      while (end < lines.length && !isFenceClose(lines[end]!.text, fence)) end += 1;
      const last = Math.min(end, lines.length - 1);
      blocks.push(makeBlock(lines, index, last, 'code'));
      index = last + 1;
      continue;
    }

    const heading = parseHeadingLine(line);
    if (heading) {
      blocks.push(makeBlock(lines, index, index, 'heading', { level: heading.depth }));
      index += 1;
      continue;
    }

    if (HORIZONTAL_RULE_PATTERN.test(line)) {
      blocks.push(makeBlock(lines, index, index, 'hr'));
      index += 1;
      continue;
    }

    const sync = SYNC_PATTERN.exec(line);
    if (sync) {
      blocks.push(makeBlock(lines, index, index, 'sync', { syncId: sync[1]! }));
      index += 1;
      continue;
    }

    const next = lines[index + 1]?.text;
    if (line.includes('|') && next !== undefined && TABLE_DELIMITER_PATTERN.test(next)) {
      let end = index + 1;
      while (end + 1 < lines.length && !isBlank(lines[end + 1]!.text) && lines[end + 1]!.text.includes('|')) {
        end += 1;
      }
      blocks.push(makeBlock(lines, index, end, 'table'));
      index = end + 1;
      continue;
    }

    if (QUOTE_PATTERN.test(line)) {
      let end = index;
      while (end + 1 < lines.length && QUOTE_PATTERN.test(lines[end + 1]!.text)) end += 1;
      const callout = CALLOUT_PATTERN.exec(line);
      const depth = Math.min(
        ...lines.slice(index, end + 1).map((entry) => /^ {0,3}(>+)/.exec(entry.text)?.[1].length ?? 1),
      );
      blocks.push(makeBlock(lines, index, end, callout ? 'callout' : 'quote', {
        level: depth,
        calloutType: callout?.[1]?.toLowerCase() ?? null,
      }));
      index = end + 1;
      continue;
    }

    const list = listDetails(line);
    if (list) {
      let end = index;
      let sawBlank = false;
      while (end + 1 < lines.length) {
        const candidate = lines[end + 1]!.text;
        if (isBlank(candidate)) {
          sawBlank = true;
          end += 1;
          continue;
        }
        if (listDetails(candidate) || sawBlank || breaksListItem(candidate)) break;
        end += 1;
      }
      while (end > index && isBlank(lines[end]!.text)) end -= 1;
      blocks.push(makeBlock(lines, index, end, 'listItem', list));
      index = end + 1;
      continue;
    }

    let end = index;
    while (end + 1 < lines.length) {
      const candidate = lines[end + 1]!.text;
      if (startsBlock(candidate, lines[end + 2]?.text, false)) break;
      end += 1;
    }
    blocks.push(makeBlock(lines, index, end, 'paragraph'));
    index = end + 1;
  }

  return blocks;
}

const textCache = new WeakMap<Text, BlockInfo[]>();

export function scanDocument(doc: Text): BlockInfo[] {
  const cached = textCache.get(doc);
  if (cached) return cached;
  const blocks = scanBlocks(doc.toString());
  textCache.set(doc, blocks);
  return blocks;
}

export function blockAt(source: string, position: number): BlockInfo | null {
  const blocks = scanBlocks(source);
  return findBlockAt(blocks, position);
}

export function findBlockAt(blocks: readonly BlockInfo[], position: number): BlockInfo | null {
  let low = 0;
  let high = blocks.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const block = blocks[middle]!;
    if (position < block.from) {
      high = middle - 1;
      continue;
    }
    if (position > block.to) {
      low = middle + 1;
      continue;
    }
    return block;
  }
  return null;
}

export function blocksInRanges(source: string, ranges: readonly BlockRange[]): BlockInfo[] {
  const blocks = scanBlocks(source);
  if (!ranges.length) return [];
  const selected = new Map<number, BlockInfo>();
  for (const range of ranges) {
    const from = Math.min(range.from, range.to);
    const to = Math.max(range.from, range.to);
    for (const block of blocks) {
      if (block.to < from) continue;
      if (block.from > to) break;
      if (from === to && (from < block.from || from > block.to)) continue;
      if (from !== to && (block.from >= to || block.to <= from)) continue;
      selected.set(block.from, block);
    }
  }
  return [...selected.values()].sort((a, b) => a.from - b.from);
}

export function withoutBlockReference(text: string): { text: string; ref: string | null } {
  const ref = blockReference(text);
  if (!ref) return { text, ref: null };
  return { text: text.replace(BLOCK_REF_PATTERN, '').trimEnd(), ref };
}

export function withBlockReference(text: string, ref: string | null): string {
  if (!ref) return text;
  const lines = text.split('\n');
  const lastIndex = lines.length - 1;
  lines[lastIndex] = `${lines[lastIndex]} ^${ref}`;
  return lines.join('\n');
}

export function headingText(block: BlockInfo): string {
  return parseHeadingLine(block.text)?.title ?? block.text;
}

export function subtreeEnd(blocks: readonly BlockInfo[], index: number): number {
  const root = blocks[index];
  if (!root || root.kind !== 'listItem') return index;
  let end = index;
  while (end + 1 < blocks.length) {
    const next = blocks[end + 1]!;
    if (next.kind !== 'listItem' || next.level <= root.level) break;
    end += 1;
  }
  return end;
}

export function isContainer(block: BlockInfo): boolean {
  return block.kind === 'listItem' || block.kind === 'quote' || block.kind === 'callout';
}
