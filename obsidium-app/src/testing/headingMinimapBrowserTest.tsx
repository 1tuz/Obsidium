import { useCallback, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { syntaxHighlighting } from '@codemirror/language';
import { h, render } from 'preact';
import type { CodeMirrorFieldRef } from '../components/Common/CodeMirrorField';
import { BookPage } from '../components/BookPage/BookPage';
import { EditorContent } from '../components/Editor/EditorContent';
import { useEditorViewSetup } from '../components/Editor/hooks/useEditorViewSetup';
import { useEditorExtensions } from '../components/Editor/extensions';
import { editorMarkdownSupport } from '../components/Editor/extensions/markdownConfig';
import { obsidiumEditorTheme, markdownStyles } from '../components/Editor/extensions/theme';
import type { ViewState } from '../modules/ui-state';
import { DEFAULT_MARKDOWN_READING_SETTINGS } from '../modules/settings';
import '../styles/index.css';
import '../components/Editor/Editor.css';
import '../components/Editor/EditorToolbar.css';
import '../components/Editor/EditingToolbar.css';
import '../components/History/HistoryView.css';
import '../components/Editor/HeadingMinimap.css';

const source = Array.from({ length: 24 }, (_, section) => [
  `# Chapter ${String(section + 1).padStart(2, '0')}`,
  ...Array.from({ length: 8 }, (_, paragraph) => `Paragraph ${paragraph + 1} in chapter ${section + 1}.`),
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

function headingLine(view: EditorView, pos: number, title: string): HTMLElement | null {
  const node = view.domAtPos(pos).node;
  const line = node instanceof HTMLElement
    ? node.closest<HTMLElement>('.cm-line')
    : node.parentElement?.closest<HTMLElement>('.cm-line') ?? null;
  return line?.textContent?.trim() === title ? line : null;
}

function actualScrollOwner(view: EditorView): HTMLElement | null {
  let element: HTMLElement | null = view.scrollDOM;
  while (element) {
    const overflow = getComputedStyle(element).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && element.scrollHeight > element.clientHeight + 1) return element;
    element = element.parentElement;
  }
  return null;
}

function scrollChain(view: EditorView): string {
  const elements: string[] = [];
  let element: HTMLElement | null = view.scrollDOM;
  while (element) {
    const overflow = getComputedStyle(element).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') {
      elements.push(`${element.className || element.tagName}=${element.scrollTop}/${element.scrollHeight}/${element.clientHeight}`);
    }
    element = element.parentElement;
  }
  return elements.join(' > ');
}

function isVisibleIn(element: HTMLElement, owner: HTMLElement): boolean {
  const line = element.getBoundingClientRect();
  const viewport = owner.getBoundingClientRect();
  const top = viewport.top + owner.clientTop;
  const bottom = viewport.bottom - owner.clientTop;
  return line.top >= top - 1 && line.top < bottom && line.bottom > top;
}

interface BrowserCase {
  bookMode: boolean;
  container: HTMLElement;
  mount: HTMLElement;
  source: string;
  view: EditorView;
  setFocused: (focused: boolean) => void;
  setReadOnly: (readOnly: boolean) => void;
}

function BrowserEditor({ bookMode, onReady }: { bookMode: boolean; onReady: (testCase: BrowserCase) => void }) {
  const [readOnly, setReadOnly] = useState(false);
  const [focused, setFocused] = useState(true);
  const mountRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<EditorView>(null);
  const titleRef = useRef<CodeMirrorFieldRef>(null);
  const path = useCallback(() => (bookMode ? 'book-browser-test.md' : 'note-browser-test.md'), [bookMode]);
  const documentId = bookMode ? 'book-browser-test' : 'note-browser-test';
  const initialViewState: ViewState = {
    path: path(),
    documentId,
    paneId: 'main',
    cursorAnchor: [],
    cursorHead: [],
    fallbackAnchor: 0,
    fallbackHead: 0,
    scrollAnchor: [],
    fallbackScrollAnchor: 0,
    scrollOffsetPx: 0,
    focusedSurface: 'editor',
  };
  const setup = useEditorViewSetup({
    documentId,
    paneId: 'main',
    focused,
    readOnly,
    viewStateReady: true,
    initialViewState,
    path,
    isReady: true,
    initialBody: source,
    onViewStateChange: () => undefined,
    setDocContent: () => undefined,
  });
  const extensions = useEditorExtensions({
    resolveWikiLinks: async (targets) => ({ paths: targets.map(() => null), complete: true }),
    onOpenWikiLink: () => undefined,
    onOpenExternalUrl: () => undefined,
    workspacePath: null,
    notePath: path,
    linkSuggest: false,
    blockHandles: false,
    slashCommands: false,
    blockHover: false,
  });

  const onCreateEditor = useCallback((view: EditorView) => {
    bodyRef.current = view;
    setup.handleCreate(view);
    const mount = mountRef.current;
    if (mount) onReady({
      bookMode,
      container: setup.containerRef.current!,
      mount,
      source,
      view,
      setFocused,
      setReadOnly,
    });
  }, [bookMode, onReady, setup.handleCreate, setup.containerRef]);

  const content = setup.ready ? (
    <EditorContent
      titleRef={titleRef}
      bodyRef={bodyRef}
      title="Minimap browser fixture"
      onCommitTitle={() => undefined}
      initialBody={source}
      selection={setup.selection}
      extensions={[
        extensions,
        obsidiumEditorTheme,
        editorMarkdownSupport,
        syntaxHighlighting(markdownStyles),
      ]}
      autoLinkTitle={false}
      readOnly={readOnly}
      onEnterEdit={() => setReadOnly(false)}
      onCreateEditor={onCreateEditor}
      onUpdate={setup.handleUpdate}
      markdownReading={DEFAULT_MARKDOWN_READING_SETTINGS}
      fullWidth
      showMinimap
    />
  ) : null;

  return (
    <section ref={mountRef} className="browser-test-case">
      <div className="q-editor-pane">
        <div className="q-editor-toolbar" aria-hidden="true" />
        {!readOnly && <div className="q-editing-toolbar q-editing-toolbar--top" aria-hidden="true" />}
        <div className="q-editor-stage">
          <div className="q-editor-stage__editor">
            <div
              ref={setup.containerRef}
              className={`q-editor-container${bookMode ? ' q-editor-container--book' : ''}`}
            >
              <BookPage isBook={bookMode}>{content}</BookPage>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

async function mountCase(bookMode: boolean): Promise<BrowserCase> {
  const mount = document.createElement('div');
  root.append(mount);
  return new Promise((resolve) => render(h(BrowserEditor, { bookMode, onReady: resolve }), mount));
}

async function waitForFixture(testCase: BrowserCase): Promise<void> {
  await waitFor(() => testCase.mount.querySelectorAll('.q-block-minimap__row').length === 24, 'Minimap rows did not render');
  await waitFor(() => actualScrollOwner(testCase.view) !== null, 'The rendered editor has no scrollable owner');
  await waitFor(() => testCase.view.state.doc.toString() === testCase.source, 'The editor document changed during setup');
  await frame();
  await frame();
}

function targetButton(testCase: BrowserCase, index: number): HTMLButtonElement {
  const button = [...testCase.mount.querySelectorAll<HTMLButtonElement>('.q-block-minimap__row')][index];
  if (!button) throw new Error(`Missing minimap row ${index}`);
  return button;
}

async function clickHeading(testCase: BrowserCase, index: number, readOnly: boolean): Promise<void> {
  const button = targetButton(testCase, index);
  const activeElement = document.activeElement;
  const title = `# Chapter ${String(index + 1).padStart(2, '0')}`;
  const pos = testCase.source.indexOf(title);
  const line = headingLine(testCase.view, pos, title);
  const owner = actualScrollOwner(testCase.view);
  assert(owner !== null, 'No actual scroll owner surrounds the editor');
  assert(line === null || !isVisibleIn(line, owner), `Chapter ${index + 1} was already visible before the navigation click`);
  assert(pos < testCase.view.viewport.from || pos > testCase.view.viewport.to, `Chapter ${index + 1} was inside the rendered editor viewport before the navigation click`);
  const selection = testCase.view.state.selection.main.anchor;
  if (readOnly) {
    const nav = button.closest<HTMLElement>('.q-block-minimap')!;
    const rowRect = button.getBoundingClientRect();
    nav.dispatchEvent(new PointerEvent('pointermove', {
      clientY: rowRect.top + rowRect.height / 2,
      bubbles: true,
    }));
    await frame();
    const label = nav.querySelector<HTMLElement>('.q-block-minimap__label');
    assert(label !== null, `Chapter ${index + 1} did not show its text label`);
    const labelRect = label.getBoundingClientRect();
    const target = document.elementFromPoint(
      labelRect.left + labelRect.width / 2,
      labelRect.top + labelRect.height / 2,
    );
    assert(target === label || label.contains(target), 'The visible heading text does not receive pointer hit testing');
    label.click();
  } else {
    button.focus();
    button.click();
  }
  try {
    await waitFor(() => {
      const nextLine = headingLine(testCase.view, pos, title);
      return nextLine !== null && isVisibleIn(nextLine, owner);
    }, `Chapter ${index + 1} did not visibly move into the actual scroll viewport`);
  } catch (error) {
    const ownerRect = owner.getBoundingClientRect();
    const lineRect = headingLine(testCase.view, pos, title)?.getBoundingClientRect();
    const resolvedOwner = testCase.container.contains(owner) ? owner.className || owner.tagName : 'outside-editor-container';
    const block = testCase.view.lineBlockAt(pos);
    const viewRect = testCase.view.dom.getBoundingClientRect();
    const renderedLine = headingLine(testCase.view, pos, title);
    throw new Error(`${error instanceof Error ? error.message : String(error)}; owner=${resolvedOwner} overflow=${getComputedStyle(owner).overflowY} scroll=${owner.scrollTop}/${owner.scrollHeight}/${owner.clientHeight} ownerRect=${ownerRect.top}:${ownerRect.bottom} line=${lineRect?.top ?? 'unrendered'} lineText=${renderedLine?.textContent ?? 'not-rendered'} block=${block.top}:${block.height} view=${viewRect.top}:${viewRect.bottom} docTop=${testCase.view.documentTop} chain=${scrollChain(testCase.view)}`);
  }
  if (readOnly) {
    assert(testCase.view.state.selection.main.anchor === selection, 'Reading navigation changed the editor selection');
    assert(document.activeElement === activeElement, 'Reading navigation changed focus');
  }
}

async function runCase(bookMode: boolean): Promise<void> {
  const testCase = await mountCase(bookMode);
  await waitForFixture(testCase);
  const initialDoc = testCase.view.state.doc;
  testCase.setReadOnly(true);
  await waitFor(() => testCase.view.state.readOnly, 'Editor did not switch into reading mode');
  await waitFor(() => actualScrollOwner(testCase.view) === (bookMode
    ? testCase.container.querySelector('.q-book-page:not(.q-book-page--inactive)')
    : testCase.view.scrollDOM), 'Reading mode did not use the actual scroll owner');
  await clickHeading(testCase, 21, true);
  await frame();
  testCase.setFocused(false);
  await frame();
  testCase.setFocused(true);
  const restoreOwner = actualScrollOwner(testCase.view)!;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await frame();
    const headingPos = testCase.source.indexOf('# Chapter 22') + 2;
    const line = headingLine(testCase.view, headingPos, '# Chapter 22');
    if (!line || !isVisibleIn(line, restoreOwner)) {
      throw new Error(`View-state restoration moved the selected heading out of view; owner=${restoreOwner.className || restoreOwner.tagName} scroll=${restoreOwner.scrollTop}/${restoreOwner.scrollHeight}/${restoreOwner.clientHeight} ownerRect=${restoreOwner.getBoundingClientRect().top}:${restoreOwner.getBoundingClientRect().bottom} line=${line?.getBoundingClientRect().top ?? 'unrendered'} viewport=${testCase.view.viewport.from}:${testCase.view.viewport.to} readOnly=${testCase.view.state.readOnly} chain=${scrollChain(testCase.view)}`);
    }
  }
  await clickHeading(testCase, 4, true);
  await clickHeading(testCase, 22, true);
  await clickHeading(testCase, 1, true);
  await clickHeading(testCase, 20, true);
  testCase.setReadOnly(false);
  await waitFor(() => !testCase.view.state.readOnly, 'Editor did not switch into editing mode');
  await clickHeading(testCase, 2, false);
  testCase.setReadOnly(true);
  await waitFor(() => testCase.view.state.readOnly, 'Editor did not return to reading mode');
  await clickHeading(testCase, 23, true);
  assert(testCase.view.state.doc === initialDoc, 'Mode switching recreated or changed the document');
  testCase.view.destroy();
}

try {
  await runCase(false);
  await runCase(true);
  results.dataset.status = 'pass';
  results.textContent = 'PASS: real EditorContent, saved view-state restoration, ordinary and book scroll owners, repeated up/down jumps, live mode switches, visible headings, selection, and focus';
} catch (error) {
  results.dataset.status = 'fail';
  results.textContent = `FAIL: ${error instanceof Error ? error.message : String(error)}`;
  throw error;
}
