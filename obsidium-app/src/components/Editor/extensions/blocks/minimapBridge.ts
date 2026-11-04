import type { Extension, Text } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { scanDocument, headingText, type BlockKind } from '../../../../modules/blocks/model';

export interface MinimapMark {
  kind: BlockKind;
  level: number;
  text: string;
  pos: number;
  ratio: number;
}

export interface MinimapState {
  marks: MinimapMark[];
  activeIndex: number;
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
}

const sessions = new WeakMap<EditorView, MinimapSession>();

export function minimapMarks(doc: Text): MinimapMark[] {
  const length = doc.length;
  return scanDocument(doc)
    .filter((block) => block.kind !== 'frontmatter')
    .map((block) => ({
      kind: block.kind,
      level: block.level,
      text: block.kind === 'heading' ? headingText(block) : block.text,
      pos: block.from,
      ratio: length > 0 ? block.from / length : 0,
    }));
}

export function activeMarkIndex(
  marks: readonly MinimapMark[],
  scrollTop: number,
  tops?: readonly number[],
): number {
  let index = -1;
  for (let i = 0; i < marks.length; i += 1) {
    const top = tops?.[i];
    if (top !== undefined ? top <= scrollTop + ACTIVE_OFFSET : marks[i].ratio <= scrollTop) {
      index = i;
    } else {
      break;
    }
  }
  return index;
}

export function compactMinimapMarks(
  marks: readonly MinimapMark[],
  pixelHeight: number,
  activeIndex: number,
): MinimapState {
  const height = Math.max(1, Math.floor(pixelHeight));
  const buckets = new Map<number, number>();
  marks.forEach((mark, index) => {
    const pixel = Math.max(0, Math.min(height - 1, Math.floor(mark.ratio * height)));
    const previous = buckets.get(pixel);
    if (previous === undefined || (mark.kind === 'heading' && marks[previous].kind !== 'heading')) {
      buckets.set(pixel, index);
    }
  });
  const retained = new Set(buckets.values());
  if (activeIndex >= 0 && activeIndex < marks.length) retained.add(activeIndex);
  const indices = [...retained].sort((a, b) => a - b);
  return { marks: indices.map((index) => marks[index]), activeIndex: indices.indexOf(activeIndex) };
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

function publish(session: MinimapSession): void {
  const state: MinimapState = { marks: session.marks, activeIndex: session.activeIndex };
  for (const listener of session.listeners) listener(state);
}

function compute(view: EditorView, session: MinimapSession): void {
  const marks = minimapMarks(view.state.doc);
  const scrollTop = view.scrollDOM.scrollTop;
  const scrollHeight = view.scrollDOM.scrollHeight;
  const tops = lineTops(view, marks);
  const activeIndex = activeMarkIndex(marks, scrollTop, tops);
  const normalized = marks.map((mark, i) => ({
    ...mark,
    ratio: scrollHeight > 0 ? Math.max(0, Math.min(1, tops[i] / scrollHeight)) : mark.ratio,
  }));
  const compacted = compactMinimapMarks(normalized, view.scrollDOM.clientHeight, activeIndex);
  session.marks = compacted.marks;
  session.activeIndex = compacted.activeIndex;
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
    marks: [],
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
      if (update.docChanged || update.geometryChanged || update.viewportChanged) {
        const session = sessions.get(update.view);
        if (session) scheduleCompute(update.view, session);
      }
    }
  },
);

export function minimapExtension(): Extension {
  return [minimapPlugin];
}
