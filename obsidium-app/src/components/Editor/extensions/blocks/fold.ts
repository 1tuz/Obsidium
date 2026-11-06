import { codeFolding, foldGutter, foldKeymap, foldService } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { findBlockAt, scanDocument, type BlockInfo } from '../../../../modules/blocks/model';

const CLOSED_CALLOUT_PATTERN = /^ {0,3}>[ \t]*\[![^\]]+\][ \t]?[-+]/;
const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;

export interface FoldRange {
  from: number;
  to: number;
}

export function headingFoldRange(blocks: readonly BlockInfo[], index: number): FoldRange | null {
  const heading = blocks[index]!;
  let to = -1;
  for (let i = index + 1; i < blocks.length; i += 1) {
    const block = blocks[i]!;
    if (block.kind === 'heading' && block.level <= heading.level) break;
    to = Math.max(to, block.to);
  }
  if (to <= heading.to) return null;
  return { from: heading.to, to };
}

export function calloutFoldRange(block: BlockInfo): FoldRange | null {
  const firstLine = block.text.split('\n')[0]!;
  if (!CLOSED_CALLOUT_PATTERN.test(firstLine)) return null;
  const from = block.from + firstLine.length;
  if (block.to <= from) return null;
  return { from, to: block.to };
}

export function codeFoldRange(block: BlockInfo): FoldRange | null {
  const lines = block.text.split('\n');
  const firstLine = lines[0]!;
  const lastLine = lines[lines.length - 1]!;
  if (lines.length < 3 || !FENCE_PATTERN.test(lastLine)) return null;
  const from = block.from + firstLine.length;
  const to = block.to - lastLine.length - 1;
  if (to <= from) return null;
  return { from, to };
}

export function blockFoldRange(state: EditorState, lineStart: number): FoldRange | null {
  const blocks = scanDocument(state.doc);
  const block = findBlockAt(blocks, lineStart);
  if (!block || block.from !== lineStart) return null;
  if (block.kind === 'heading') return headingFoldRange(blocks, blocks.indexOf(block));
  if (block.kind === 'callout') return calloutFoldRange(block);
  if (block.kind === 'code') return codeFoldRange(block);
  return null;
}

const blockFoldTheme = EditorView.theme({
  '.cm-foldGutter .cm-gutterElement': {
    padding: '0 var(--q-padding-xs)',
    color: 'var(--q-text-tertiary)',
    cursor: 'pointer',
  },
  '.cm-foldGutter .cm-gutterElement:hover': {
    color: 'var(--q-text-primary)',
  },
  '.cm-foldPlaceholder': {
    padding: '0 var(--q-padding-xs)',
    border: 'var(--q-border-1) solid var(--q-border-default)',
    borderRadius: 'var(--q-radius-sm)',
    backgroundColor: 'var(--q-bg-surface-raised)',
    color: 'var(--q-text-secondary)',
  },
});

export function blockFoldExtension(): Extension {
  return [
    codeFolding(),
    foldGutter({ openText: '▾', closedText: '▸' }),
    keymap.of(foldKeymap),
    foldService.of((state, lineStart) => blockFoldRange(state, lineStart)),
    blockFoldTheme,
  ];
}
