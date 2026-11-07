import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  findBlockAt,
  scanDocument,
  withBlockReference,
  withoutBlockReference,
  type BlockInfo,
  type BlockRange,
} from '../../../../modules/blocks/model';
import {
  deleteBlocks,
  duplicateBlocks,
  moveBlocks,
  type DropTarget,
} from '../../../../modules/blocks/move';
import { TURN_MENU, turnIntoChanges } from '../../../../modules/blocks/turnInto';
import type { MenuEntry } from '../../../Common/Menu';
import { t } from '../../../../i18n';
import { closeBlockMenu, openBlockMenu } from './menuHost';
import './handles.css';

export interface BlockHandlesOptions {
  enabled: boolean;
  path: () => string;
}

const EDGE_SCROLL_MARGIN = 48;
const EDGE_SCROLL_STEP = 8;
const EDGE_HIT_SLOP = 4;
const HANDLE_SIZE = 20;
const CONTAINER_ZONE_RATIO = 0.25;

interface DragState {
  pointerId: number;
  startBlock: BlockInfo;
  selection: BlockRange[];
  moved: boolean;
  target: DropTarget | null;
}

function blockRanges(block: BlockInfo): BlockRange[] {
  return [{ from: block.from, to: block.to }];
}

function dispatchRanges(
  view: EditorView,
  build: (source: string, ranges: readonly BlockRange[]) => { from: number; to: number; insert: string } | null,
  ranges: readonly BlockRange[],
): void {
  const source = view.state.doc.toString();
  const change = build(source, ranges);
  if (!change) return;
  view.dispatch({
    changes: change,
    selection: { anchor: change.from + change.insert.length },
    scrollIntoView: true,
  });
}

function copyBlockLink(view: EditorView, block: BlockInfo, path: () => string): void {
  const source = view.state.doc.toString();
  const stripped = withoutBlockReference(block.text);
  const ref = stripped.ref ?? generateBlockRef(source);
  if (!stripped.ref) {
    const updated = withBlockReference(block.text, ref);
    view.dispatch({
      changes: { from: block.from, to: block.to, insert: updated },
    });
  }
  void navigator.clipboard?.writeText(`[[${path()}#^${ref}]]`);
}

function generateBlockRef(source: string): string {
  const existing = new Set(
    [...source.matchAll(/\^([A-Za-z0-9][\w-]*)/g)].map((match) => match[1]),
  );
  let counter = 1;
  while (existing.has(`blk-${counter}`)) counter += 1;
  return `blk-${counter}`;
}

async function createSynced(view: EditorView, ranges: readonly BlockRange[]): Promise<void> {
  try {
    const module = await import('../../../../modules/blocks/syncedStore');
    if (typeof module.createSyncedBlock !== 'function') return;
    await module.createSyncedBlock(view, ranges);
  } catch {
    return;
  }
}

function menuItems(view: EditorView, block: BlockInfo, path: () => string): MenuEntry[] {
  const ranges = blockRanges(block);
  const items: MenuEntry[] = [
    {
      id: 'duplicate',
      label: t('blocks.duplicate'),
      onSelect: () => dispatchRanges(view, duplicateBlocks, ranges),
    },
    {
      id: 'copyLink',
      label: t('blocks.copyLink'),
      onSelect: () => copyBlockLink(view, block, path),
    },
    {
      id: 'insertSynced',
      label: t('blocks.insertSynced'),
      onSelect: () => { void createSynced(view, ranges); },
    },
    {
      id: 'delete',
      label: t('blocks.delete'),
      danger: true,
      onSelect: () => dispatchRanges(view, deleteBlocks, ranges),
    },
    { type: 'separator', id: 'turnInto-separator' },
  ];
  for (const entry of TURN_MENU) {
    items.push({
      id: `turnInto-${entry.target}`,
      label: t(`blocks.target${entry.target.charAt(0).toUpperCase()}${entry.target.slice(1)}`),
      onSelect: () => {
        const source = view.state.doc.toString();
        const changes = turnIntoChanges(source, ranges, entry.target);
        if (!changes.length) return;
        view.dispatch({ changes });
      },
    });
  }
  return items;
}

function dropTargetAt(view: EditorView, clientX: number, clientY: number): DropTarget | null {
  const pos = view.posAtCoords({ x: clientX, y: clientY });
  if (pos === null) return null;
  const block = findBlockAt(scanDocument(view.state.doc), pos);
  if (!block || block.kind === 'frontmatter') return null;
  const top = view.coordsAtPos(block.from);
  const bottom = view.coordsAtPos(Math.min(block.to, view.state.doc.length));
  if (!top || !bottom) return null;
  const height = bottom.bottom - top.top;
  const relative = (clientY - top.top) / Math.max(1, height);
  const container = block.kind === 'listItem' || block.kind === 'quote' || block.kind === 'callout';
  if (relative <= CONTAINER_ZONE_RATIO) return { mode: 'before', block };
  if (relative >= 1 - CONTAINER_ZONE_RATIO) return { mode: 'after', block };
  if (container) return { mode: 'inside', block };
  return { mode: relative < 0.5 ? 'before' : 'after', block };
}

export function blockHandlesExtension(options: BlockHandlesOptions): Extension {
  if (!options.enabled) return [];
  return ViewPlugin.fromClass(
    class {
      private readonly handle: HTMLElement;
      private readonly indicator: HTMLElement;
      private readonly overlay: HTMLElement;
      private readonly hoverHost: HTMLElement;
      private drag: DragState | null = null;
      private edgeScrollTimer: number | null = null;

      private readonly view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        this.overlay = document.createElement('div');
        this.overlay.className = 'q-block-overlay';
        this.handle = document.createElement('div');
        this.handle.className = 'q-block-handle';
        this.handle.setAttribute('role', 'button');
        this.handle.setAttribute('aria-label', t('blocks.dragHandle'));
        this.handle.textContent = '⋮⋮';
        this.indicator = document.createElement('div');
        this.indicator.className = 'q-block-drop-indicator';
        this.overlay.append(this.handle, this.indicator);
        view.dom.appendChild(this.overlay);
        this.hoverHost = view.dom.closest<HTMLElement>('.q-editor-pane') ?? view.dom;
        this.hoverHost.addEventListener('pointermove', this.onHoverMove);
        this.hoverHost.addEventListener('pointerleave', this.onLeave);
        this.handle.addEventListener('pointerdown', this.onHandlePointerDown);
        this.handle.addEventListener('click', this.onHandleClick);
      }

      update(update: ViewUpdate) {
        if (update.docChanged) {
          this.hideHandle();
          this.clearDrag();
        }
        if (update.selectionSet && this.drag) this.clearDrag();
      }

      destroy() {
        this.clearDrag();
        this.hoverHost.removeEventListener('pointermove', this.onHoverMove);
        this.hoverHost.removeEventListener('pointerleave', this.onLeave);
        this.overlay.remove();
      }

      private readonly onHoverMove = (event: PointerEvent): void => {
        if (this.drag) return;
        if (event.target instanceof HTMLElement && this.handle.contains(event.target)) return;
        const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return this.hideHandle();
        const block = findBlockAt(scanDocument(this.view.state.doc), pos);
        if (!block || block.kind === 'frontmatter') return this.hideHandle();
        this.showHandle(block, event.clientY);
      };

      private readonly onLeave = () => {
        if (this.drag) return;
        this.hideHandle();
      };

      private readonly onHandlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        event.preventDefault();
        this.handle.setPointerCapture(event.pointerId);
        const pos = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
        const block = pos === null ? null : findBlockAt(scanDocument(this.view.state.doc), pos);
        const anchor = block ?? this.currentHandleBlock();
        if (!anchor) return;
        this.drag = {
          pointerId: event.pointerId,
          startBlock: anchor,
          selection: blockRanges(anchor),
          moved: false,
          target: null,
        };
        this.handle.addEventListener('pointermove', this.onDragMove);
        this.handle.addEventListener('pointerup', this.onDragEnd);
        this.handle.addEventListener('pointercancel', this.onDragCancel);
        window.addEventListener('keydown', this.onKeyDown, true);
      };

      private readonly onDragMove = (event: PointerEvent) => {
        if (!this.drag) return;
        this.drag.moved = true;
        const target = dropTargetAt(this.view, event.clientX, event.clientY);
        this.drag.target = target;
        if (target) this.showIndicator(target);
        else this.hideIndicator();
        this.autoScroll(event.clientY);
      };

      private readonly onDragEnd = () => {
        const drag = this.drag;
        if (!drag) return;
        const target = drag.target;
        this.clearDrag();
        closeBlockMenu(this.view);
        if (!drag.moved || !target) return;
        const source = this.view.state.doc.toString();
        const change = moveBlocks(source, drag.selection, target);
        if (!change) return;
        this.view.dispatch({
          changes: change,
          selection: { anchor: change.from + change.insert.length },
          scrollIntoView: true,
        });
      };

      private readonly onDragCancel = () => this.clearDrag();

      private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || !this.drag) return;
        event.preventDefault();
        this.clearDrag();
      };

      private readonly onHandleClick = () => {
        const block = this.currentHandleBlock();
        if (!block) return;
        const rect = this.handle.getBoundingClientRect();
        openBlockMenu(this.view, {
          items: menuItems(this.view, block, options.path),
          position: { top: rect.bottom, left: rect.right },
          ariaLabel: t('blocks.menu'),
          exclude: this.handle,
        });
      };

      private currentHandleBlock(): BlockInfo | null {
        const top = Number(this.handle.dataset.blockFrom ?? NaN);
        if (Number.isNaN(top)) return null;
        return findBlockAt(scanDocument(this.view.state.doc), top);
      }

      private showHandle(block: BlockInfo, cursorY: number): void {
        this.handle.dataset.blockFrom = String(block.from);
        const top = this.view.coordsAtPos(block.from);
        if (!top) return;
        const scrollerRect = this.view.scrollDOM.getBoundingClientRect();
        if (top.top < scrollerRect.top - EDGE_HIT_SLOP || top.top > scrollerRect.bottom) {
          this.hideHandle();
          return;
        }
        const editorRect = this.view.dom.getBoundingClientRect();
        this.handle.style.top = `${cursorY - editorRect.top - HANDLE_SIZE / 2}px`;
      }

      private hideHandle(): void {
        delete this.handle.dataset.blockFrom;
        this.handle.style.top = '';
      }

      private showIndicator(target: DropTarget): void {
        const doc = this.view.state.doc;
        const blocks = scanDocument(doc);
        let endPos = target.block.to;
        if (target.block.kind === 'listItem') {
          const index = blocks.findIndex((entry) => entry.from === target.block.from);
          if (index >= 0) {
            let last = index;
            while (
              last + 1 < blocks.length
              && blocks[last + 1]!.kind === 'listItem'
              && blocks[last + 1]!.level > target.block.level
            ) last += 1;
            endPos = blocks[last]!.to;
          }
        }
        const coords = target.mode === 'before'
          ? this.view.coordsAtPos(target.block.from)
          : target.mode === 'after'
            ? this.view.coordsAtPos(Math.min(endPos, doc.length))
            : this.view.coordsAtPos(Math.min(target.block.to, doc.length));
        if (!coords) return;
        const editorRect = this.view.dom.getBoundingClientRect();
        const y = target.mode === 'after' ? coords.bottom : coords.top;
        this.indicator.style.top = `${y - editorRect.top}px`;
        this.indicator.dataset.mode = target.mode;
        this.indicator.classList.add('q-block-drop-indicator--visible');
      }

      private hideIndicator(): void {
        this.indicator.classList.remove('q-block-drop-indicator--visible');
      }

      private autoScroll(clientY: number): void {
        const scroller = this.view.scrollDOM;
        const rect = scroller.getBoundingClientRect();
        const nearTop = clientY - rect.top < EDGE_SCROLL_MARGIN;
        const nearBottom = rect.bottom - clientY < EDGE_SCROLL_MARGIN;
        if (!nearTop && !nearBottom) {
          this.stopEdgeScroll();
          return;
        }
        if (this.edgeScrollTimer !== null) return;
        const direction = nearTop ? -EDGE_SCROLL_STEP : EDGE_SCROLL_STEP;
        this.edgeScrollTimer = window.setInterval(() => {
          scroller.scrollTop += direction;
        }, 16);
      }

      private stopEdgeScroll(): void {
        if (this.edgeScrollTimer === null) return;
        window.clearInterval(this.edgeScrollTimer);
        this.edgeScrollTimer = null;
      }

      private clearDrag(): void {
        this.stopEdgeScroll();
        this.hideIndicator();
        if (this.drag) {
          this.handle.releasePointerCapture(this.drag.pointerId);
          this.handle.removeEventListener('pointermove', this.onDragMove);
          this.handle.removeEventListener('pointerup', this.onDragEnd);
          this.handle.removeEventListener('pointercancel', this.onDragCancel);
          window.removeEventListener('keydown', this.onKeyDown, true);
        }
        this.drag = null;
      }
    },
  );
}
