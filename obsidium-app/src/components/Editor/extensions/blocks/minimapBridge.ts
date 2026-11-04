import type { Extension, Text } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { scanDocument, headingText } from '../../../../modules/blocks/model';

export interface MinimapHeading {
  level: number;
  text: string;
  pos: number;
  ratio: number;
}

export interface MinimapState {
  headings: MinimapHeading[];
  activeIndex: number;
}

type MinimapListener = (state: MinimapState) => void;

const ACTIVE_OFFSET = 24;

interface MinimapSession {
  listeners: Set<MinimapListener>;
  headings: MinimapHeading[];
  activeIndex: number;
  rafId: number | null;
  onScroll: () => void;
  observer: ResizeObserver | null;
}

const sessions = new WeakMap<EditorView, MinimapSession>();

export function minimapHeadings(doc: Text): MinimapHeading[] {
  const length = doc.length;
  return scanDocument(doc)
    .filter((block) => block.kind === 'heading' && block.level >= 1 && block.level <= 6)
    .map((block) => ({
      level: block.level,
      text: headingText(block),
      pos: block.from,
      ratio: length > 0 ? block.from / length : 0,
    }));
}

export function activeHeadingIndex(
  headings: readonly MinimapHeading[],
  scrollTop: number,
  tops?: readonly number[],
): number {
  let index = -1;
  for (let i = 0; i < headings.length; i += 1) {
    const top = tops?.[i];
    if (top !== undefined ? top <= scrollTop + ACTIVE_OFFSET : headings[i].ratio <= scrollTop) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

function lineTops(view: EditorView, headings: readonly MinimapHeading[]): number[] {
  return headings.map((heading) => {
    try {
      return view.lineBlockAt(heading.pos).top;
    } catch {
      return 0;
    }
  });
}

function publish(session: MinimapSession): void {
  const state: MinimapState = { headings: session.headings, activeIndex: session.activeIndex };
  for (const listener of session.listeners) listener(state);
}

function compute(view: EditorView, session: MinimapSession): void {
  const headings = minimapHeadings(view.state.doc);
  const scrollTop = view.scrollDOM.scrollTop;
  const scrollHeight = view.scrollDOM.scrollHeight;
  const tops = lineTops(view, headings);
  const activeIndex = activeHeadingIndex(headings, scrollTop, tops);
  const normalized = headings.map((heading, i) => ({
    ...heading,
    ratio: scrollHeight > 0 ? Math.max(0, Math.min(1, tops[i] / scrollHeight)) : heading.ratio,
  }));
  session.headings = normalized;
  session.activeIndex = activeIndex;
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
  view.scrollDOM.removeEventListener('scroll', session.onScroll);
  session.observer?.disconnect();
  session.observer = null;
  sessions.delete(view);
}

function ensureSession(view: EditorView): MinimapSession {
  const existing = sessions.get(view);
  if (existing) return existing;
  const session: MinimapSession = {
    listeners: new Set(),
    headings: [],
    activeIndex: -1,
    rafId: null,
    onScroll: () => scheduleCompute(view, session),
    observer: null,
  };
  const scrollDOM = view.scrollDOM;
  scrollDOM.addEventListener('scroll', session.onScroll, { passive: true });
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
      if (update.docChanged) {
        const session = sessions.get(update.view);
        if (session) scheduleCompute(update.view, session);
      }
    }
  },
);

export function minimapExtension(): Extension {
  return [minimapPlugin];
}
