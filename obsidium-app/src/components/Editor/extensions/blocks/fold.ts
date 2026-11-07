import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from '@codemirror/view';
import { codeFolding, foldEffect, foldKeymap, foldService, foldedRanges, unfoldEffect } from '@codemirror/language';
import { ChevronDown, ChevronRight } from 'lucide';
import { createIconElement } from '../../../Common/iconElement';
import { t } from '../../../../i18n';
import { findBlockAt, scanDocument, type BlockInfo } from '../../../../modules/blocks/model';
import './fold.css';

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

class FoldMarkerWidget extends WidgetType {
  constructor(private readonly folded: boolean) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'q-block-fold';
    button.dataset.folded = this.folded ? 'true' : 'false';
    button.setAttribute('aria-label', this.folded ? t('blocks.unfold') : t('blocks.fold'));
    button.append(createIconElement(this.folded ? ChevronRight : ChevronDown));
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const line = view.state.doc.lineAt(view.posAtDOM(button));
      const folded = foldedRanges(view.state).iter();
      let target: { from: number; to: number } | null = null;
      while (folded.value) {
        if (folded.from <= line.to && folded.to >= line.from) target = { from: folded.from, to: folded.to };
        folded.next();
      }
      if (target) view.dispatch({ effects: unfoldEffect.of(target) });
      else {
        const range = blockFoldRange(view.state, line.from);
        if (range) view.dispatch({ effects: foldEffect.of(range) });
      }
    });
    return button;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function foldMarkerDecorations(view: EditorView): DecorationSet {
  const builder: Range<Decoration>[] = [];
  for (const block of scanDocument(view.state.doc)) {
    if (block.kind !== 'heading' && block.kind !== 'callout' && block.kind !== 'code') continue;
    const range = blockFoldRange(view.state, block.from);
    if (!range) continue;
    let folded = false;
    foldedRanges(view.state).between(range.from, range.to, (foldFrom, foldTo) => {
      if (foldFrom <= range.from && foldTo >= range.to) folded = true;
    });
    builder.push(
      Decoration.widget({
        widget: new FoldMarkerWidget(folded),
        side: 1,
      }).range(block.from),
    );
  }
  return Decoration.set(builder, true);
}

const foldMarkerPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = foldMarkerDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = foldMarkerDecorations(update.view);
      }
    }
  },
  { decorations: (instance) => instance.decorations },
);

export function blockFoldExtension(): Extension {
  return [
    codeFolding(),
    keymap.of(foldKeymap),
    foldService.of((state, lineStart) => blockFoldRange(state, lineStart)),
    foldMarkerPlugin,
  ];
}
