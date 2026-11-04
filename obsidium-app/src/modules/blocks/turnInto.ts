import { orderedSuffix } from '../../components/Editor/extensions/outline/constructs';
import { parseHeadingLine } from '../docs/noteEmbeds';
import {
  blocksInRanges,
  withBlockReference,
  withoutBlockReference,
  type BlockInfo,
  type BlockRange,
  type TextChange,
} from './model';

export type TurnTarget =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'quote'
  | 'code'
  | 'toggle';

export type TurnBlockKind = 'paragraph' | 'heading' | 'listItem' | 'quote' | 'callout' | 'code';

export interface TurnMenuItem {
  target: TurnTarget;
  kind: TurnBlockKind;
  level: number;
  listKind: 'bullet' | 'ordered' | 'task' | null;
  label: string;
}

const LIST_TARGETS: Record<string, true> = { bullet: true, ordered: true, task: true };
const SKIPPED_KINDS: Record<string, true> = { frontmatter: true, sync: true, hr: true };

export const TURN_MENU: readonly TurnMenuItem[] = [
  { target: 'paragraph', label: 'blocks.targetText', kind: 'paragraph', level: 0, listKind: null },
  { target: 'heading1', label: 'blocks.targetHeading1', kind: 'heading', level: 1, listKind: null },
  { target: 'heading2', label: 'blocks.targetHeading2', kind: 'heading', level: 2, listKind: null },
  { target: 'heading3', label: 'blocks.targetHeading3', kind: 'heading', level: 3, listKind: null },
  { target: 'heading4', label: 'blocks.targetHeading4', kind: 'heading', level: 4, listKind: null },
  { target: 'heading5', label: 'blocks.targetHeading5', kind: 'heading', level: 5, listKind: null },
  { target: 'heading6', label: 'blocks.targetHeading6', kind: 'heading', level: 6, listKind: null },
  { target: 'bullet', label: 'blocks.targetBullet', kind: 'listItem', level: 1, listKind: 'bullet' },
  { target: 'ordered', label: 'blocks.targetOrdered', kind: 'listItem', level: 1, listKind: 'ordered' },
  { target: 'task', label: 'blocks.targetTask', kind: 'listItem', level: 1, listKind: 'task' },
  { target: 'quote', label: 'blocks.targetQuote', kind: 'quote', level: 0, listKind: null },
  { target: 'code', label: 'blocks.targetCode', kind: 'code', level: 0, listKind: null },
  { target: 'toggle', label: 'blocks.targetToggle', kind: 'callout', level: 0, listKind: null },
];

export function turnTargetFor(block: BlockInfo): TurnTarget {
  if (block.kind === 'heading') {
    return `heading${Math.min(6, Math.max(1, block.level))}` as TurnTarget;
  }
  if (block.kind === 'listItem') {
    if (block.listKind === 'task') return 'task';
    if (block.listKind === 'ordered') return 'ordered';
    return 'bullet';
  }
  if (block.kind === 'quote') return 'quote';
  if (block.kind === 'code') return 'code';
  if (block.kind === 'callout' && /^ {0,3}>[ \t]*\[!note\][ \t]?[-+]/.test(block.text)) return 'toggle';
  return 'paragraph';
}

export function turnIntoChanges(
  source: string,
  ranges: readonly BlockRange[],
  target: TurnTarget,
): TextChange[] {
  return blocksInRanges(source, ranges)
    .filter((block) => SKIPPED_KINDS[block.kind] !== true)
    .map((block) => ({
      from: block.from,
      to: block.to,
      insert: convertBlock(block, target),
    }));
}

export function applyTurnInto(source: string, ranges: readonly BlockRange[], target: TurnTarget): string {
  const changes = turnIntoChanges(source, ranges, target);
  let result = source;
  for (const change of changes.slice().sort((a, b) => b.from - a.from)) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  return result;
}

export function turnSelectionRange(
  source: string,
  from: number,
  to: number,
): { from: number; to: number } {
  const blocks = blocksInRanges(source, [{ from, to }]);
  if (!blocks.length) return { from, to };
  return { from: blocks[0]!.from, to: blocks[blocks.length - 1]!.to };
}

function convertBlock(block: BlockInfo, target: TurnTarget): string {
  const stripped = withoutBlockReference(block.text);
  const body = renderTarget(block, withoutContainerPrefix(block, stripped.text.split('\n')), target);
  return withBlockReference(body, block.ref);
}

function withoutContainerPrefix(block: BlockInfo, lines: string[]): string[] {
  if (block.kind === 'quote' || block.kind === 'callout') {
    const stripped = lines.map((line) => line.replace(/^ {0,3}> ?/, ''));
    if (block.kind === 'callout') {
      stripped[0] = stripped[0]!.replace(/^\[![^\]]+\][+-]?[ \t]*/, '');
    }
    return stripped;
  }
  if (block.kind === 'heading') {
    const parsed = parseHeadingLine(lines[0] ?? '');
    return parsed ? [parsed.title, ...lines.slice(1)] : lines;
  }
  if (block.kind === 'listItem') {
    const prefixLength = block.indent.length + (block.marker?.length ?? 0) + 1;
    const continuation = `${block.indent}${' '.repeat((block.marker?.length ?? 1) + 1)}`;
    const first = (lines[0] ?? '').slice(prefixLength).replace(/^\[[ xX]\]\s/, '');
    return [
      first,
      ...lines.slice(1).map((line) => (line.startsWith(continuation) ? line.slice(continuation.length) : line)),
    ];
  }
  if (block.kind === 'code') {
    const inner = lines.slice(1);
    if (inner.length > 0 && /^ {0,3}(?:`{3,}|~{3,})\s*$/.test(inner[inner.length - 1]!)) inner.pop();
    return inner;
  }
  return lines;
}

function renderTarget(block: BlockInfo, payload: string[], target: TurnTarget): string {
  if (target === 'paragraph') return payload.join('\n').trimEnd();
  if (target === 'code') return ['```', ...payload, '```'].join('\n');
  if (target === 'quote') return payload.map((line) => (line.trim() === '' ? '>' : `> ${line}`)).join('\n');
  if (target === 'toggle') return renderToggle(payload);
  if (LIST_TARGETS[target] === true) return renderList(block, payload, target);
  return renderHeading(payload, Number(target.slice('heading'.length)));
}

function renderHeading(payload: string[], level: number): string {
  const [first = '', ...rest] = payload;
  return [`${'#'.repeat(level)} ${first.replace(/^\s{0,3}#{1,6}\s*/, '')}`, ...rest].join('\n');
}

function renderToggle(payload: string[]): string {
  const [title = '', ...rest] = payload;
  const head = `> [!note]- ${title}`.trimEnd();
  if (!rest.length) return head;
  return [head, ...rest.map((line) => (line.trim() === '' ? '>' : `> ${line}`))].join('\n');
}

function renderList(block: BlockInfo, payload: string[], target: TurnTarget): string {
  const indent = block.kind === 'listItem' ? block.indent : '';
  const marker = target === 'ordered' ? nextOrderedMarker(block) : '-';
  const padding = ' '.repeat(marker.length + 1);
  const checkbox = target === 'task' ? '[ ] ' : '';
  const [first = '', ...rest] = payload;
  const head = `${indent}${marker} ${checkbox}${first}`;
  const lines = rest.map((line) => (line.trim() === '' ? '' : `${indent}${padding}${line.trimStart()}`));
  return [head, ...lines].join('\n');
}

function nextOrderedMarker(block: BlockInfo): string {
  if (block.kind !== 'listItem' || block.listKind !== 'ordered') return '1.';
  const number = Number(block.marker?.replace(/[.)]$/, ''));
  return `${Number.isFinite(number) ? number : 1}${orderedSuffix(block.marker ?? '.')}`;
}
