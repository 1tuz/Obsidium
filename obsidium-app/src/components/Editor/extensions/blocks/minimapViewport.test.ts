// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView, type BlockInfo } from '@codemirror/view';
import { afterEach, expect, it, vi } from 'vitest';
import { minimapExtension, subscribeMinimap, type MinimapState } from './minimapBridge';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); document.body.replaceChildren(); });

it.each([false, true])('uses the visible scroll viewport and tracks scroll in reading mode %s', async (readOnly) => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  container.className = 'q-editor-container';
  const content = document.createElement('div');
  content.className = `q-editor-content${readOnly ? ' q-editor-content--reading' : ''}`;
  const body = document.createElement('div');
  body.className = 'q-editor-content__body';
  container.append(content); content.append(body); document.body.append(container);
  const source = Array.from({ length: 200 }, (_, i) => `# paragraph ${i}`).join('\n\n');
  const view = new EditorView({ parent: body, state: EditorState.create({ doc: source, extensions: [minimapExtension(), EditorState.readOnly.of(readOnly)] }) });
  const owner = readOnly ? view.scrollDOM : container;
  Object.defineProperty(owner, 'clientHeight', { configurable: true, value: 40 });
  Object.defineProperty(view.scrollDOM, 'scrollHeight', { configurable: true, value: 4000 });
  if (!readOnly) Object.defineProperty(view.scrollDOM, 'clientHeight', { configurable: true, value: 4000 });
  vi.spyOn(view, 'lineBlockAt').mockImplementation((pos) => ({ top: view.state.doc.lineAt(pos).number * 10 } as BlockInfo));
  vi.spyOn(owner, 'getBoundingClientRect').mockImplementation(() => ({ top: 100, bottom: 140, height: 40 } as DOMRect));
  if (!readOnly) vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: 100 - owner.scrollTop, bottom: 4100 - owner.scrollTop, height: 4000 } as DOMRect));
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => ({ top: 70, bottom: 4070, height: 4000 } as DOMRect));
  let state: MinimapState | undefined;
  const unsubscribe = subscribeMinimap(view, (next) => { state = next; });
  expect(state!.marks.length).toBe(200);
  expect(state!.viewportHeight).toBe(40);
  expect(state!.top).toBe(30);
  const first = state!.marks[state!.activeIndex]?.pos;
  owner.scrollTop = 1000;
  owner.dispatchEvent(new Event('scroll'));
  await vi.advanceTimersByTimeAsync(30);
  expect(state!.marks[state!.activeIndex]?.pos).toBeGreaterThan(first ?? -1);
  unsubscribe(); view.destroy();
});

it('clamps the rail to the body when the editing scroll owner starts above it', () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  container.className = 'q-editor-container';
  const content = document.createElement('div');
  content.className = 'q-editor-content';
  const body = document.createElement('div');
  body.className = 'q-editor-content__body';
  container.append(content); content.append(body); document.body.append(container);
  const view = new EditorView({ parent: body, state: EditorState.create({ doc: '# Heading\n\nparagraph', extensions: [minimapExtension()] }) });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 860 });
  Object.defineProperty(view.scrollDOM, 'scrollHeight', { configurable: true, value: 4000 });
  Object.defineProperty(view.scrollDOM, 'clientHeight', { configurable: true, value: 4000 });
  vi.spyOn(view, 'lineBlockAt').mockImplementation(() => ({ top: 0 } as BlockInfo));
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ top: 40, bottom: 900, height: 860 } as DOMRect));
  vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: 40, bottom: 4040, height: 4000 } as DOMRect));
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => ({ top: 70, bottom: 4070, height: 4000 } as DOMRect));
  let state: MinimapState | undefined;
  const unsubscribe = subscribeMinimap(view, (next) => { state = next; });
  expect(state!.top).toBe(0);
  expect(state!.viewportHeight).toBe(830);
  unsubscribe(); view.destroy();
  vi.useRealTimers();
});

it('does not re-query block geometry on scroll frames with unchanged layout', async () => {
  vi.useFakeTimers();
  const observed: Array<() => void> = [];
  const previous = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) { observed.push(callback); }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  const container = document.createElement('div');
  container.className = 'q-editor-container';
  const content = document.createElement('div');
  content.className = 'q-editor-content';
  const body = document.createElement('div');
  body.className = 'q-editor-content__body';
  container.append(content); content.append(body); document.body.append(container);
  const source = Array.from({ length: 60 }, (_, index) => `# heading ${index}\n\ntext`).join('\n\n');
  const view = new EditorView({ parent: body, state: EditorState.create({ doc: source, extensions: [minimapExtension()] }) });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 40 });
  Object.defineProperty(view.scrollDOM, 'scrollHeight', { configurable: true, value: 4000 });
  Object.defineProperty(view.scrollDOM, 'clientHeight', { configurable: true, value: 4000 });
  const lineBlockAt = vi.spyOn(view, 'lineBlockAt').mockImplementation((pos) => ({ top: view.state.doc.lineAt(pos).number * 10 } as BlockInfo));
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 40, height: 40 } as DOMRect));
  vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: -container.scrollTop, bottom: 4000 - container.scrollTop, height: 4000 } as DOMRect));
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 4000, height: 4000 } as DOMRect));

  let state: MinimapState | undefined;
  const unsubscribe = subscribeMinimap(view, (next) => { state = next; });
  expect(state!.marks.length).toBe(60);
  expect(lineBlockAt).toHaveBeenCalledTimes(60);

  const seen: number[] = [];
  for (const scrollTop of [200, 600, 1200, 2000]) {
    container.scrollTop = scrollTop;
    container.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(30);
    seen.push(state!.activeIndex);
  }
  expect(lineBlockAt).toHaveBeenCalledTimes(60);
  expect(new Set(seen).size).toBeGreaterThan(1);

  view.dispatch({ changes: { from: 0, insert: '# prepended\n\n' } });
  await vi.advanceTimersByTimeAsync(30);
  expect(lineBlockAt.mock.calls.length).toBeGreaterThan(60);

  const before = lineBlockAt.mock.calls.length;
  observed.forEach((callback) => callback());
  await vi.advanceTimersByTimeAsync(30);
  expect(lineBlockAt.mock.calls.length).toBeGreaterThan(before);

  unsubscribe(); view.destroy();
  globalThis.ResizeObserver = previous;
});

it('publishes a heading title edited at the same offset and level', async () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  container.className = 'q-editor-container';
  const content = document.createElement('div');
  content.className = 'q-editor-content';
  const body = document.createElement('div');
  body.className = 'q-editor-content__body';
  container.append(content); content.append(body); document.body.append(container);
  const source = '# Alpha\n\ntext\n\n## Beta\n\ntext';
  const view = new EditorView({ parent: body, state: EditorState.create({ doc: source, extensions: [minimapExtension()] }) });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 40 });
  Object.defineProperty(view.scrollDOM, 'scrollHeight', { configurable: true, value: 4000 });
  Object.defineProperty(view.scrollDOM, 'clientHeight', { configurable: true, value: 4000 });
  vi.spyOn(view, 'lineBlockAt').mockImplementation((pos) => ({ top: view.state.doc.lineAt(pos).number * 10 } as BlockInfo));
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 40, height: 40 } as DOMRect));
  vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 4000, height: 4000 } as DOMRect));
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 4000, height: 4000 } as DOMRect));

  let state: MinimapState | undefined;
  const unsubscribe = subscribeMinimap(view, (next) => { state = next; });
  expect(state!.marks.map((mark) => mark.text)).toEqual(['Alpha', 'Beta']);

  view.dispatch({ changes: { from: source.indexOf('Beta'), to: source.indexOf('Beta') + 'Beta'.length, insert: 'Gamma' } });
  await vi.advanceTimersByTimeAsync(30);
  expect(state!.marks.map((mark) => mark.text)).toEqual(['Alpha', 'Gamma']);
  expect(state!.marks.map((mark) => mark.pos)).toEqual([0, source.indexOf('## Beta')]);

  unsubscribe(); view.destroy();
});

it('keeps the active section monotonic when a block measurement fails', async () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  container.className = 'q-editor-container';
  const content = document.createElement('div');
  content.className = 'q-editor-content';
  const body = document.createElement('div');
  body.className = 'q-editor-content__body';
  container.append(content); content.append(body); document.body.append(container);
  const source = Array.from({ length: 8 }, (_, index) => `# heading ${index}\n\ntext`).join('\n\n');
  const view = new EditorView({ parent: body, state: EditorState.create({ doc: source, extensions: [minimapExtension()] }) });
  Object.defineProperty(container, 'clientHeight', { configurable: true, value: 40 });
  Object.defineProperty(view.scrollDOM, 'scrollHeight', { configurable: true, value: 4000 });
  Object.defineProperty(view.scrollDOM, 'clientHeight', { configurable: true, value: 4000 });
  let call = 0;
  vi.spyOn(view, 'lineBlockAt').mockImplementation((pos) => {
    call += 1;
    if (call % 3 === 0) throw new Error('layout not ready');
    return { top: view.state.doc.lineAt(pos).number * 10 } as BlockInfo;
  });
  vi.spyOn(container, 'getBoundingClientRect').mockImplementation(() => ({ top: 0, bottom: 40, height: 40 } as DOMRect));
  vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: -container.scrollTop, bottom: 4000 - container.scrollTop, height: 4000 } as DOMRect));
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => ({ top: -container.scrollTop, bottom: 4000 - container.scrollTop, height: 4000 } as DOMRect));

  const seen: number[] = [];
  const unsubscribe = subscribeMinimap(view, (next) => { seen.push(next.activeIndex); });
  for (const scrollTop of [0, 120, 240]) {
    container.scrollTop = scrollTop;
    container.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(30);
  }
  for (let index = 1; index < seen.length; index += 1) {
    expect(seen[index]!).toBeGreaterThanOrEqual(seen[index - 1]!);
  }
  expect(seen[seen.length - 1]).toBeGreaterThan(0);

  unsubscribe(); view.destroy();
  vi.useRealTimers();
});
