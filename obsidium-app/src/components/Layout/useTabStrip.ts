import { useEffect, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { useStableCallback } from '../../hooks/useStableCallback';
import { reorderLayout, restingOffset, type TabBox } from './tabReorderModel';

const DRAG_THRESHOLD = 4;
const EDGE = 48;
const EDGE_STEP = 14;

function boxesOf(tabs: HTMLElement[]): TabBox[] {
  return tabs.map((tab) => ({ left: tab.offsetLeft, width: tab.offsetWidth }));
}

function transitionMs(element: HTMLElement): number {
  return parseFloat(getComputedStyle(element).transitionDuration) * 1000 || 0;
}

function prefersReducedMotion(): boolean {
  if (document.documentElement.dataset.motion === 'on') return false;
  if (document.documentElement.dataset.motion === 'off') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useTabStrip(
  strip: RefObject<HTMLElement | null>,
  onReorder: (from: number, to: number) => void,
  onMoveTab?: (tabId: string, paneId: string, beforeTabId: string | null) => void,
  enabled = true,
) {
  const reorder = useStableCallback(onReorder);
  const moveTab = useStableCallback(onMoveTab ?? (() => {}));

  useEffect(() => {
    const element = strip.current;
    if (!element || !enabled) return;

    let tabs: HTMLElement[] = [];
    let boxes: TabBox[] = [];
    let from = -1;
    let target = -1;
    let startX = 0;
    let startY = 0;
    let startScroll = 0;
    let dragging = false;
    let settle: (() => void) | null = null;
    let settleTimer = 0;
    let sourcePaneId = '';
    let sourceTabId = '';
    let dropPaneId = '';
    let dropTabId: string | null = null;

    function clear() {
      element?.removeAttribute('data-reordering');
      for (const tab of tabs) {
        tab.style.transition = '';
        tab.style.transform = '';
        delete tab.dataset.dragging;
      }
      document.body.style.cursor = '';
      tabs = [];
      boxes = [];
      from = -1;
      target = -1;
      dragging = false;
      sourcePaneId = '';
      sourceTabId = '';
      dropPaneId = '';
      dropTabId = null;
    }

    function scrollAtEdge(clientX: number) {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (clientX < rect.left + EDGE) element.scrollLeft -= EDGE_STEP;
      else if (clientX > rect.right - EDGE) element.scrollLeft += EDGE_STEP;
    }

    function onMove(event: MouseEvent) {
      if (!dragging) {
        if (Math.hypot(event.clientX - startX, event.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        element?.setAttribute('data-reordering', '');
        tabs[from]!.dataset.dragging = '';
        document.body.style.cursor = 'grabbing';
      }
      scrollAtEdge(event.clientX);
      const offset = event.clientX - startX + ((element?.scrollLeft ?? 0) - startScroll);
      const layout = reorderLayout(boxes, from, offset);
      target = layout.target;
      const pointed = document.elementFromPoint(event.clientX, event.clientY);
      const pane = pointed?.closest<HTMLElement>('[data-pane-drop-target]');
      dropPaneId = pane?.dataset.paneDropTarget && pane.dataset.paneDropTarget !== sourcePaneId
        ? pane.dataset.paneDropTarget : '';
      const dropTarget = dropPaneId ? pointed?.closest<HTMLElement>('[data-tab-id]') ?? null : null;
      if (dropTarget && event.clientX > dropTarget.getBoundingClientRect().left + dropTarget.offsetWidth / 2) {
        dropTabId = dropTarget.nextElementSibling instanceof HTMLElement
          ? dropTarget.nextElementSibling.dataset.tabId ?? null
          : null;
      } else {
        dropTabId = dropTarget?.dataset.tabId ?? null;
      }
      for (let index = 0; index < tabs.length; index += 1) {
        tabs[index]!.style.transform = `translateX(${layout.shift[index] ?? 0}px)`;
      }
    }

    function swallowClick(event: MouseEvent) {
      event.stopPropagation();
      event.preventDefault();
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragging) {
        clear();
        return;
      }
      document.addEventListener('click', swallowClick, { capture: true, once: true });

      const moved = from;
      const dropped = target;
      const dragged = tabs[from]!;
      if (dropPaneId && sourceTabId) {
        moveTab(sourceTabId, dropPaneId, dropTabId);
        clear();
        return;
      }
      const finish = () => {
        window.clearTimeout(settleTimer);
        settle = null;
        if (dropped !== moved) flushSync(() => reorder(moved, dropped));
        clear();
      };

      if (prefersReducedMotion()) {
        finish();
        return;
      }
      settle = finish;
      dragged.style.transition = 'transform var(--q-duration-fast) var(--q-ease-out)';
      dragged.style.transform = `translateX(${restingOffset(boxes, moved, dropped)}px)`;
      settleTimer = window.setTimeout(finish, transitionMs(dragged));
    }

    function onDown(event: MouseEvent) {
      if (event.button !== 0 || !element) return;
      settle?.();
      document.removeEventListener('click', swallowClick, true);
      const source = event.target as Element | null;
      const tab = source?.closest<HTMLElement>('[data-tab-path]');
      if (!tab || tab.dataset.renaming !== undefined) return;
      if (source?.closest('button, .q-titlebar-tab-rename')) return;

      tabs = [...element.querySelectorAll<HTMLElement>('[data-tab-path]')];
      from = tabs.indexOf(tab);
      if (from < 0) return;
      boxes = boxesOf(tabs);
      target = from;
      sourcePaneId = element.dataset.paneId ?? '';
      sourceTabId = tab.dataset.tabId ?? '';
      startX = event.clientX;
      startY = event.clientY;
      startScroll = element.scrollLeft;
      dragging = false;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    element.addEventListener('mousedown', onDown);
    return () => {
      element.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.clearTimeout(settleTimer);
      settle = null;
      clear();
    };
  }, [enabled, moveTab, reorder, strip]);
}
