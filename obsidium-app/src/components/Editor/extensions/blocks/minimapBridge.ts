import type { Extension, Text } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { scanDocument, headingText } from '../../../../modules/blocks/model';
import { resolveEditorScrollElement } from '../../viewState/scroll';

export interface MinimapMark {
  level: number;
  text: string;
  pos: number;
}

export interface MinimapState {
  marks: MinimapMark[];
  activeIndex: number;
  top: number;
  viewportHeight: number;
}

interface MinimapLayout {
  doc: Text;
  marks: MinimapMark[];
  ceilings: number[];
}

type MinimapListener = (state: MinimapState) => void;

const ACTIVE_OFFSET = 24;

interface MinimapSession {
  listeners: Set<MinimapListener>;
  layout: MinimapLayout | null;
  stale: boolean;
  publishedMarks: MinimapMark[];
  activeIndex: number;
  rafId: number | null;
  onScroll: () => void;
  observer: ResizeObserver | null;
  owner: HTMLElement | null;
  top: number;
  viewportHeight: number;
}

const sessions = new WeakMap<EditorView, MinimapSession>();

export function minimapMarks(doc: Text): MinimapMark[] {
  return scanDocument(doc)
    .filter((block) => block.kind === 'heading')
    .map((block) => ({
      level: block.level,
      text: headingText(block),
      pos: block.from,
    }));
}

export function activeMarkIndex(
  marks: readonly MinimapMark[],
  scrollTop: number,
  tops: readonly number[],
): number {
  let index = -1;
  for (let i = 0; i < marks.length; i += 1) {
    if (tops[i] <= scrollTop + ACTIVE_OFFSET) index = i;
    else break;
  }
  return index;
}

function measureLayout(view: EditorView): MinimapLayout {
  const marks = minimapMarks(view.state.doc);
  const ceilings: number[] = [];
  for (const mark of marks) {
    let top = 0;
    try {
      top = view.lineBlockAt(mark.pos).top;
    } catch {
      top = 0;
    }
    const previous = ceilings.length > 0 ? ceilings[ceilings.length - 1]! : top;
    ceilings.push(Math.max(top, previous));
  }
  return { doc: view.state.doc, marks, ceilings };
}

function activeMarkIndexFromCeilings(ceilings: readonly number[], scrollTop: number): number {
  const limit = scrollTop + ACTIVE_OFFSET;
  let low = 0;
  let high = ceilings.length - 1;
  let index = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (ceilings[middle]! <= limit) {
      index = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return index;
}

function sameMarks(left: readonly MinimapMark[], right: readonly MinimapMark[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i]!;
    const b = right[i]!;
    if (a.pos !== b.pos || a.level !== b.level || a.text !== b.text) return false;
  }
  return true;
}

function publish(session: MinimapSession): void {
  const state: MinimapState = {
    marks: session.publishedMarks,
    activeIndex: session.activeIndex,
    top: session.top,
    viewportHeight: session.viewportHeight,
  };
  for (const listener of session.listeners) listener(state);
}

function compute(view: EditorView, session: MinimapSession): void {
  if (session.stale || session.layout === null || session.layout.doc !== view.state.doc) {
    session.layout = measureLayout(view);
    session.stale = false;
  }
  const layout = session.layout!;
  const marks = layout.marks;
  const container = view.dom.closest<HTMLElement>('.q-editor-container');
  const owner = container ? resolveEditorScrollElement(container, view.state.readOnly, view.scrollDOM) : view.scrollDOM;
  if (session.owner !== owner) {
    session.owner?.removeEventListener('scroll', session.onScroll);
    if (session.owner) session.observer?.unobserve(session.owner);
    session.owner = owner;
    owner.addEventListener('scroll', session.onScroll, { passive: true });
    session.observer?.observe(owner);
  }
  const ownerRect = owner.getBoundingClientRect();
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const paneRect = view.dom.closest<HTMLElement>('.q-editor-pane')?.getBoundingClientRect();
  const bodyRect = view.dom.closest('.q-editor-content__body')?.getBoundingClientRect();
  const anchorTop = paneRect?.top ?? bodyRect?.top ?? ownerRect.top;
  const visibleTop = Math.max(ownerRect.top, bodyRect?.top ?? ownerRect.top);
  const visibleBottom = Math.min(
    ownerRect.bottom,
    bodyRect?.bottom ?? ownerRect.bottom,
    paneRect?.bottom ?? ownerRect.bottom,
  );
  const top = Math.max(0, Math.round(visibleTop - anchorTop));
  const viewportHeight = Math.max(0, Math.round(visibleBottom - visibleTop));
  const scrollTop = owner === view.scrollDOM ? owner.scrollTop : ownerRect.top - scrollRect.top;
  const activeIndex = activeMarkIndexFromCeilings(layout.ceilings, scrollTop);
  const unchanged =
    session.top === top &&
    session.viewportHeight === viewportHeight &&
    session.activeIndex === activeIndex &&
    sameMarks(session.publishedMarks, marks);
  session.activeIndex = activeIndex;
  session.top = top;
  session.viewportHeight = viewportHeight;
  if (unchanged) return;
  session.publishedMarks = marks;
  publish(session);
}

function scheduleCompute(view: EditorView, session: MinimapSession): void {
  if (session.rafId !== null) return;
  session.rafId = requestAnimationFrame(() => {
    session.rafId = null;
    compute(view, session);
  });
}

function teardownSession(view: EditorView, session: MinimapSession): void {
  if (session.rafId !== null) cancelAnimationFrame(session.rafId);
  session.rafId = null;
  session.owner?.removeEventListener('scroll', session.onScroll);
  session.observer?.disconnect();
  session.observer = null;
  sessions.delete(view);
}

function ensureSession(view: EditorView): MinimapSession {
  const existing = sessions.get(view);
  if (existing) return existing;
  const session: MinimapSession = {
    listeners: new Set(),
    layout: null,
    stale: true,
    publishedMarks: [],
    activeIndex: -1,
    rafId: null,
    onScroll: () => scheduleCompute(view, session),
    observer: null,
    owner: null,
    top: 0,
    viewportHeight: 0,
  };
  const scrollDOM = view.scrollDOM;
  if (typeof ResizeObserver !== 'undefined') {
    session.observer = new ResizeObserver(() => {
      session.stale = true;
      scheduleCompute(view, session);
    });
    session.observer.observe(scrollDOM);
  }
  sessions.set(view, session);
  return session;
}

export function jumpToMinimapMark(view: EditorView, pos: number): void {
  if (!view.state.readOnly) {
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
    view.focus();
    return;
  }
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
}

export function subscribeMinimap(
  view: EditorView,
  listener: MinimapListener,
): () => void {
  const session = ensureSession(view);
  session.listeners.add(listener);
  compute(view, session);
  return () => {
    session.listeners.delete(listener);
    if (session.listeners.size === 0) teardownSession(view, session);
  };
}

const minimapPlugin = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate): void {
      if (!update.docChanged && !update.geometryChanged && !update.viewportChanged && update.startState.readOnly === update.state.readOnly) return;
      const session = sessions.get(update.view);
      if (!session) return;
      if (update.geometryChanged) session.stale = true;
      scheduleCompute(update.view, session);
    }
  },
);

export function minimapExtension(): Extension {
  return [minimapPlugin];
}
