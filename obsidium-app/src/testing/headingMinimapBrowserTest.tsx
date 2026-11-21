import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { h, render } from 'preact';
import { initI18n } from '../i18n';
import { HeadingMinimap } from '../components/Editor/HeadingMinimap';
import { ViewStateController } from '../components/Editor/viewState/controller';
import { resolveEditorScrollElement } from '../components/Editor/viewState/scroll';
import { minimapExtension } from '../components/Editor/extensions/blocks/minimapBridge';
import '../styles/index.css';
import '../components/Editor/Editor.css';
import '../components/Editor/HeadingMinimap.css';
import '../components/BookPage/BookPage.css';

initI18n();

const source = Array.from({ length: 18 }, (_, section) => [
  `# Chapter ${String(section + 1).padStart(2, '0')}`,
  ...Array.from({ length: 5 }, (_, paragraph) => `Paragraph ${paragraph + 1} in chapter ${section + 1}.`),
].join('\n\n')).join('\n\n');

const root = document.querySelector<HTMLElement>('#root')!;
const results = document.createElement('output');
results.className = 'browser-test-results';
results.setAttribute('aria-live', 'polite');
results.dataset.status = 'running';
results.textContent = 'Running heading minimap browser checks';
root.append(results);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitFor(predicate: () => boolean, message: string, timeoutMs = 4000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await frame();
  }
  throw new Error(message);
}

function headingLine(view: EditorView, pos: number): HTMLElement | null {
  const node = view.domAtPos(pos).node;
  const line = node instanceof HTMLElement ? node.closest<HTMLElement>('.cm-line') : node.parentElement?.closest<HTMLElement>('.cm-line');
  return line ?? null;
}

function isVisibleIn(element: HTMLElement, owner: HTMLElement): boolean {
  const line = element.getBoundingClientRect();
  const viewport = owner.getBoundingClientRect();
  const top = viewport.top + owner.clientTop;
  const bottom = viewport.bottom - owner.clientTop;
  return line.top >= top - 1 && line.top < bottom && line.bottom > top;
}

function createCase(bookMode: boolean) {
  const fixture = document.createElement('section');
  fixture.className = 'browser-test-case';
  const pane = document.createElement('div');
  pane.className = 'q-editor-pane';
  const container = document.createElement('div');
  container.className = `q-editor-container${bookMode ? ' q-editor-container--book' : ''}`;
  const book = document.createElement('div');
  book.className = `q-book-page${bookMode ? ' q-book-page--has-cover' : ' q-book-page--inactive'}`;
  const cover = document.createElement('div');
  cover.className = 'q-book-hero browser-test-case__cover';
  const wrapper = document.createElement('div');
  wrapper.className = `q-book-content-wrapper${bookMode ? '' : ' q-book-content-wrapper--inactive'}`;
  const bookEditor = document.createElement('div');
  bookEditor.className = 'q-book-editor-container';
  const content = document.createElement('div');
  content.className = 'q-editor-content';
  const title = document.createElement('div');
  title.className = 'q-editor-inline-title-cm';
  title.textContent = 'Minimap browser fixture';
  const body = document.createElement('div');
  body.className = 'q-editor-content__body';
  const cm = document.createElement('div');
  cm.className = 'q-editor-content__cm';

  root.append(fixture);
  fixture.append(pane);
  pane.append(container);
  container.append(book);
  if (bookMode) book.append(cover);
  book.append(wrapper);
  wrapper.append(bookEditor);
  bookEditor.append(content);
  content.append(title, body);
  body.append(cm);

  const mode = new Compartment();
  const view = new EditorView({
    parent: cm,
    state: EditorState.create({
      doc: source,
      extensions: [
        minimapExtension(),
        EditorView.theme({ '&': { height: '100%' }, '& .cm-scroller': { height: '100% !important' } }),
        mode.of([EditorState.readOnly.of(false), EditorView.editable.of(true)]),
      ],
    }),
  });
  render(h(HeadingMinimap, { view }), body);

  const initialState = {
    documentId: bookMode ? 'book-browser-test' : 'note-browser-test',
    paneId: 'main',
    cursorAnchor: [],
    cursorHead: [],
    fallbackAnchor: 0,
    fallbackHead: 0,
    scrollAnchor: [],
    fallbackScrollAnchor: source.indexOf('# Chapter 03'),
    scrollOffsetPx: 0,
    focusedSurface: 'editor',
  };
  const controller = new ViewStateController({
    documentId: initialState.documentId,
    path: () => bookMode ? 'book.md' : 'note.md',
    initial: initialState,
    resolved: {
      anchor: 0,
      head: 0,
      scroll: initialState.fallbackScrollAnchor,
    },
    isFocused: () => false,
    onChange: () => undefined,
  });
  controller.attach(view, resolveEditorScrollElement(container, false, view.scrollDOM));

  const toggleMode = (readOnly: boolean) => {
    content.classList.toggle('q-editor-content--reading', readOnly);
    view.dispatch({ effects: mode.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]) });
    controller.setScrollElement(resolveEditorScrollElement(container, readOnly, view.scrollDOM));
  };

  return { bookMode, container, controller, fixture, pane, source, toggleMode, view };
}

async function clickHeading(testCase: ReturnType<typeof createCase>, index: number, readOnly: boolean): Promise<void> {
  const rows = [...testCase.pane.querySelectorAll<HTMLButtonElement>('.q-block-minimap__row')];
  const row = rows[index];
  assert(row !== undefined, `Missing minimap row ${index}`);
  const pos = testCase.source.indexOf(`# Chapter ${String(index + 1).padStart(2, '0')}`);
  const selection = testCase.view.state.selection.main.anchor;
  row.focus();
  row.click();
  const owner = resolveEditorScrollElement(testCase.container, readOnly, testCase.view.scrollDOM);
  try {
    await waitFor(() => {
      const line = headingLine(testCase.view, pos);
      return line !== null && isVisibleIn(line, owner);
    }, `Chapter ${index + 1} did not enter the scroll viewport`);
  } catch (error) {
    const ownerRect = owner.getBoundingClientRect();
    const scrollerRect = testCase.view.scrollDOM.getBoundingClientRect();
    const blockTop = testCase.view.lineBlockAt(pos).top;
    const lineRect = headingLine(testCase.view, pos)?.getBoundingClientRect();
    throw new Error(`${error instanceof Error ? error.message : String(error)}; owner=${owner.tagName}.${owner.className} overflow=${getComputedStyle(owner).overflowY} scroll=${owner.scrollTop}/${owner.scrollHeight}/${owner.clientHeight} rect=${ownerRect.top}:${ownerRect.bottom} cm=${testCase.view.scrollDOM.scrollTop} rect=${scrollerRect.top}:${scrollerRect.bottom} documentTop=${testCase.view.documentTop} blockTop=${blockTop} line=${lineRect?.top ?? 'unrendered'} book=${testCase.container.querySelector('.q-book-page')?.scrollTop}`);
  }
  if (readOnly) {
    assert(testCase.view.state.selection.main.anchor === selection, 'Reading navigation changed the editor selection');
    assert(document.activeElement === row, 'Reading navigation moved focus away from the minimap');
  }
}

async function runCase(bookMode: boolean, keepResult = false): Promise<void> {
  const testCase = createCase(bookMode);
  const initialDoc = testCase.view.state.doc;
  await waitFor(() => testCase.pane.querySelectorAll('.q-block-minimap__row').length === 18, 'Minimap rows did not render');
  const firstReadToggle = testCase.pane.querySelector('.q-editor-content')!;
  assert(!firstReadToggle.classList.contains('q-editor-content--reading'), 'Fixture did not start in edit mode');
  testCase.toggleMode(true);
  await clickHeading(testCase, 17, true);
  await clickHeading(testCase, 1, true);
  await clickHeading(testCase, 11, true);
  testCase.toggleMode(false);
  await clickHeading(testCase, 14, false);
  testCase.toggleMode(true);
  await clickHeading(testCase, 0, true);
  await clickHeading(testCase, 17, true);
  assert(testCase.view.state.doc === initialDoc, 'Mode switching recreated or changed the document');
  assert(resolveEditorScrollElement(testCase.container, true, testCase.view.scrollDOM) === (bookMode ? testCase.pane.querySelector('.q-book-page') : testCase.view.scrollDOM), 'Scroll owner did not match the rendered layout');
  testCase.controller.dispose();
  if (!keepResult) {
    testCase.view.destroy();
    testCase.fixture.remove();
  }
}

try {
  await runCase(false);
  await runCase(true, true);
  results.dataset.status = 'pass';
  results.textContent = 'PASS: ordinary and book reading scroll, repeated up/down jumps, live mode switches, selection, focus, and view-state restore';
} catch (error) {
  results.dataset.status = 'fail';
  results.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
}
