import type { EditorState, Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view';
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

interface FoldMarkerState {
  pos: number;
  folded: boolean;
}

const MARKER_HIT_SLOP = 4;

function foldMarkerStates(view: EditorView): FoldMarkerState[] {
  const states: FoldMarkerState[] = [];
  for (const block of scanDocument(view.state.doc)) {
    if (block.kind !== 'heading' && block.kind !== 'callout' && block.kind !== 'code') continue;
    const range = blockFoldRange(view.state, block.from);
    if (!range) continue;
    let folded = false;
    foldedRanges(view.state).between(range.from, range.to, (foldFrom, foldTo) => {
      if (foldFrom <= range.from && foldTo >= range.to) folded = true;
    });
    states.push({ pos: block.from, folded });
  }
  return states;
}

class FoldMarkerLayer {
  private readonly view: EditorView;
  private readonly layer: HTMLElement;
  private readonly buttons = new Map<number, HTMLButtonElement>();
  private rafId: number | null = null;

  constructor(view: EditorView) {
    this.view = view;
    this.layer = document.createElement('div');
    this.layer.className = 'q-block-fold-layer';
    const host = view.dom.closest<HTMLElement>('.q-editor-pane') ?? view.dom.parentElement ?? document.body;
    host.append(this.layer);
    this.layer.addEventListener('click', this.onClick);
    view.scrollDOM.addEventListener('scroll', this.scheduleSync, { passive: true });
    view.scrollDOM.addEventListener('pointermove', this.onHoverMove, { passive: true });
    view.scrollDOM.addEventListener('pointerleave', this.onHoverLeave, { passive: true });
  }

  sync(): void {
    const scroller = this.view.scrollDOM;
    const scrollerRect = scroller.getBoundingClientRect();
    const paddingTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    const layerRect = this.layer.getBoundingClientRect();
    const contentLeft = this.view.contentDOM.getBoundingClientRect().left;
    const states = foldMarkerStates(this.view);
    const seen = new Set<number>();
    for (const state of states) {
      const screenTop = scrollerRect.top - scroller.scrollTop + paddingTop + this.view.lineBlockAt(state.pos).top;
      const visible = screenTop >= scrollerRect.top - MARKER_HIT_SLOP && screenTop <= scrollerRect.bottom;
      let button = this.buttons.get(state.pos);
      if (!visible) {
        if (button) {
          button.remove();
          this.buttons.delete(state.pos);
        }
        continue;
      }
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'q-block-fold';
        button.addEventListener('mousedown', (event) => event.preventDefault());
        this.layer.append(button);
        this.buttons.set(state.pos, button);
      }
      seen.add(state.pos);
      const foldedFlag = state.folded ? 'true' : 'false';
      if (button.dataset.folded !== foldedFlag) {
        button.replaceChildren(createIconElement(state.folded ? ChevronRight : ChevronDown));
      }
      button.dataset.blockFrom = String(state.pos);
      button.dataset.folded = foldedFlag;
      button.setAttribute('aria-label', state.folded ? t('blocks.unfold') : t('blocks.fold'));
      button.style.top = `${screenTop - layerRect.top}px`;
      button.style.left = `${contentLeft - layerRect.left}px`;
    }
    for (const [pos, button] of this.buttons) {
      if (!seen.has(pos)) {
        button.remove();
        this.buttons.delete(pos);
      }
    }
  }

  scheduleSync = (): void => {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.sync();
    });
  };

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.view.scrollDOM.removeEventListener('scroll', this.scheduleSync);
    this.view.scrollDOM.removeEventListener('pointermove', this.onHoverMove);
    this.view.scrollDOM.removeEventListener('pointerleave', this.onHoverLeave);
    this.layer.remove();
  }

  private readonly onHoverMove = (event: PointerEvent): void => {
    const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
    const lineFrom = pos === null ? null : this.view.state.doc.lineAt(pos).from;
    for (const [blockFrom, button] of this.buttons) {
      button.dataset.hovered = blockFrom === lineFrom ? 'true' : 'false';
    }
  };

  private readonly onHoverLeave = (): void => {
    for (const button of this.buttons.values()) button.dataset.hovered = 'false';
  };

  private readonly onClick = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest('.q-block-fold') as HTMLElement | null;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const pos = Number(button.dataset.blockFrom);
    if (!Number.isFinite(pos)) return;
    const line = this.view.state.doc.lineAt(pos);
    const folded = foldedRanges(this.view.state).iter();
    let target: { from: number; to: number } | null = null;
    while (folded.value) {
      if (folded.from <= line.to && folded.to >= line.from) target = { from: folded.from, to: folded.to };
      folded.next();
    }
    if (target) this.view.dispatch({ effects: unfoldEffect.of(target) });
    else {
      const range = blockFoldRange(this.view.state, line.from);
      if (range) this.view.dispatch({ effects: foldEffect.of(range) });
    }
  };
}

const foldMarkerPlugin = ViewPlugin.fromClass(
  class {
    private readonly layer: FoldMarkerLayer;

    constructor(view: EditorView) {
      this.layer = new FoldMarkerLayer(view);
      this.layer.sync();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged || update.geometryChanged || update.selectionSet) {
        this.layer.scheduleSync();
      }
    }

    destroy(): void {
      this.layer.destroy();
    }
  },
);

export function blockFoldExtension(): Extension {
  return [
    codeFolding({
      placeholderDOM: (_view, onclick) => {
        const span = document.createElement('span');
        span.className = 'q-block-fold-placeholder';
        span.textContent = '…';
        span.setAttribute('aria-label', t('blocks.unfold'));
        span.onclick = onclick;
        return span;
      },
    }),
    keymap.of(foldKeymap),
    foldService.of((state, lineStart) => blockFoldRange(state, lineStart)),
    foldMarkerPlugin,
  ];
}
