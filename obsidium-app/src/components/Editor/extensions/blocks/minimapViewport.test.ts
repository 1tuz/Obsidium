// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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
  const source = Array.from({ length: 200 }, (_, i) => `paragraph ${i}`).join('\n\n');
  const view = new EditorView({ parent: body, state: EditorState.create({ doc: source, extensions: [minimapExtension(), EditorState.readOnly.of(readOnly)] }) });
  const owner = readOnly ? view.scrollDOM : container;
  Object.defineProperty(owner, 'clientHeight', { configurable: true, value: 40 });
  Object.defineProperty(view.scrollDOM, 'scrollHeight', { configurable: true, value: 4000 });
  if (!readOnly) Object.defineProperty(view.scrollDOM, 'clientHeight', { configurable: true, value: 4000 });
  vi.spyOn(view, 'lineBlockAt').mockImplementation((pos) => ({ top: view.state.doc.lineAt(pos).number * 10 } as ReturnType<EditorView['lineBlockAt']>));
  vi.spyOn(owner, 'getBoundingClientRect').mockImplementation(() => ({ top: 100, bottom: 140, height: 40 } as DOMRect));
  if (!readOnly) vi.spyOn(view.scrollDOM, 'getBoundingClientRect').mockImplementation(() => ({ top: 100 - owner.scrollTop, bottom: 4100 - owner.scrollTop, height: 4000 } as DOMRect));
  vi.spyOn(body, 'getBoundingClientRect').mockImplementation(() => ({ top: 70, bottom: 4070, height: 4000 } as DOMRect));
  let state: MinimapState | undefined;
  const unsubscribe = subscribeMinimap(view, (next) => { state = next; });
  expect(state!.marks.length).toBeLessThanOrEqual(41);
  expect(state!.height).toBe(40);
  expect(state!.top).toBe(30);
  const first = state!.marks[state!.activeIndex]?.pos;
  owner.scrollTop = 1000;
  owner.dispatchEvent(new Event('scroll'));
  await vi.advanceTimersByTimeAsync(30);
  expect(state!.marks[state!.activeIndex]?.pos).toBeGreaterThan(first ?? -1);
  unsubscribe(); view.destroy();
});
