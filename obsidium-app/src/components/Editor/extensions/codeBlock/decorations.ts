import { RangeSetBuilder, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet } from '@codemirror/view';
import { shouldRevealSyntax } from '../livePreviewVisibility';
import type { CodeBlockShape } from './blocks';
import { codeBlockControlDecoration } from './controls';

const LINE_CLASS = 'q-md-code-line';
const HIDDEN_LINE = Decoration.replace({ block: true });

function lineDecoration(...modifiers: readonly string[]): Decoration {
  return Decoration.line({ class: [LINE_CLASS, ...modifiers].join(' ') });
}

const BODY_LINE = lineDecoration();
const FIRST_LINE = lineDecoration(`${LINE_CLASS}--first`);
const LAST_LINE = lineDecoration(`${LINE_CLASS}--last`);
const ONLY_LINE = lineDecoration(`${LINE_CLASS}--first`, `${LINE_CLASS}--last`);

function edgeDecoration(isFirst: boolean, isLast: boolean): Decoration {
  if (isFirst && isLast) return ONLY_LINE;
  if (isFirst) return FIRST_LINE;
  if (isLast) return LAST_LINE;
  return BODY_LINE;
}

function hiddenFences(doc: Text, block: CodeBlockShape, head: number): { first: number; last: number } | null {
  const opening = doc.lineAt(block.from);
  if (block.contentFrom >= block.contentTo) return null;
  const hideOpening = !shouldRevealSyntax(doc, head, opening.from, opening.to);
  const closing = block.contentTo < block.end ? doc.lineAt(block.contentTo) : null;
  const hideClosing = closing !== null
    && closing.number !== opening.number
    && !shouldRevealSyntax(doc, head, closing.from, closing.to);
  if (!hideOpening) return hideClosing && closing ? { first: closing.number, last: closing.number } : null;
  return { first: opening.number, last: hideClosing && closing ? closing.number : opening.number };
}

export function codeBlockDecorations(
  doc: Text,
  blocks: readonly CodeBlockShape[],
  head: number,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of blocks) {
    const first = doc.lineAt(block.from).number;
    const last = doc.lineAt(block.end).number;
    const hidden = hiddenFences(doc, block, head);
    let visibleFirst = -1;
    let visibleLast = -1;
    for (let number = first; number <= last; number += 1) {
      if (hidden && (number === hidden.first || number === hidden.last)) continue;
      if (visibleFirst < 0) visibleFirst = number;
      visibleLast = number;
    }
    if (visibleFirst < 0) continue;
    for (let number = first; number <= last; number += 1) {
      const { from, to } = doc.line(number);
      if (hidden && (number === hidden.first || number === hidden.last)) {
        builder.add(from, to, HIDDEN_LINE);
        continue;
      }
      builder.add(from, from, edgeDecoration(number === visibleFirst, number === visibleLast));
    }
  }

  return builder.finish();
}

export function codeBlockControls(blocks: readonly CodeBlockShape[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  for (const block of blocks) {
    const controls = codeBlockControlDecoration(block);
    if (controls) builder.add(block.from, block.from, controls);
  }

  return builder.finish();
}
