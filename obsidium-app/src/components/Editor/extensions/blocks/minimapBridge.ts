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

type MinimapListener = (state: MinimapState) => void;

const ACTIVE_OFFSET = 24;

interface MinimapSession {
  listeners: Set<MinimapListener>;
  marks: MinimapMark[];
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

function lineTops(view: EditorView, marks: readonly MinimapMark[]): number[] {
  return marks.map((mark) => {
    try {
      return view.lineBlockAt(mark.pos).top;
    } catch {
      return 0;
    }
  });
}

function sameMarks(left: readonly MinimapMark[], right: readonly MinimapMark[]): boolean {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].pos !== right[i].pos || left[i].level !== right[i].level) return false;
  }
  return true;
}

function publish(session: MinimapSession): void {
  const state: MinimapState = {
    marks: session.marks,
    activeIndex: session.activeIndex,
    top: session.top,
    viewportHeight: session.viewportHeight,
  };
  for (const listener of session.listeners) listener(state);
}

function compute(view: EditorView, session: MinimapSession): void {
  const marks = minimapMarks(view.state.doc);
  const container = view.dom.closest<HTMLElement>('.q-editor-container');
  const owner = container ? resolveEditorScrollElement(container, view.state.readOnly) : view.scrollDOM;
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
  const activeIndex = activeMarkIndex(marks, scrollTop, lineTops(view, marks));
  const unchanged =
    session.top === top &&
    session.viewportHeight === viewportHeight &&
    session.activeIndex === activeIndex &&
    sameMarks(session.marks, marks);
  session.marks = marks;
  session.activeIndex = activeIndex;
  session.top = top;
  session.viewportHeight = viewportHeight;
  if (!unchanged) publish(session);
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
    marks: [],
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
    session.observer = new ResizeObserver(() => scheduleCompute(view, session));
    session.observer.observe(scrollDOM);
  }
  sessions.set(view, session);
  return session;
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
      if (update.docChanged || update.geometryChanged || update.viewportChanged || update.startState.readOnly !== update.state.readOnly) {
        const session = sessions.get(update.view);
        if (session) scheduleCompute(update.view, session);
      }
    }
  },
);

export function minimapExtension(): Extension {
  return [minimapPlugin];
}
