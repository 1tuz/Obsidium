// @vitest-environment happy-dom
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorMarkdownSupport } from '../markdownConfig';
import { codeBlockExtension } from './index';

const copyText = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());

vi.mock('../../../../modules/clipboard', () => ({ copyText }));

const FENCED = '```js\nconst count = 1;\n```';
const EMPTY_FENCED = '```js\n```';

function mount(doc: string, caret?: number, editable?: Compartment, readOnly = false) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: caret ?? doc.length },
      extensions: [
        editorMarkdownSupport,
        codeBlockExtension,
        EditorView.lineWrapping,
        ...(editable ? [editable.of(EditorView.editable.of(true))] : []),
        ...(readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
      ],
    }),
    parent,
  });
  return { view, parent };
}

async function settle() {
  for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
}

function codeLines(parent: HTMLElement): string[] {
  return [...parent.querySelectorAll('.cm-line.q-md-code-line')].map((line) => line.textContent ?? '');
}

describe('code block extension', () => {
  let view: EditorView | null = null;
  let parent: HTMLElement | null = null;

  afterEach(() => {
    view?.destroy();
    parent?.remove();
    view = null;
    parent = null;
    vi.useRealTimers();
    copyText.mockReset();
  });

  it('mounts fenced code controls without throwing a block decoration error', async () => {
    const mounted = mount(FENCED);
    view = mounted.view;
    parent = mounted.parent;
    await settle();

    expect(parent.querySelector('.q-md-code-controls')).not.toBeNull();
  });

  it('renders the opening fence while the caret is inside it', async () => {
    const mounted = mount(FENCED, 0);
    view = mounted.view;
    parent = mounted.parent;
    await settle();

    expect(codeLines(parent)[0]).toBe('```js');
    expect(parent.querySelector('.cm-line.q-md-code-line--first')?.textContent).toBe('```js');
  });

  it('renders the closing fence while the caret is inside it', async () => {
    const mounted = mount(FENCED, FENCED.length - 1);
    view = mounted.view;
    parent = mounted.parent;
    await settle();

    expect(codeLines(parent)).toEqual(['const count = 1;', '```']);
    expect(parent.querySelector('.cm-line.q-md-code-line--last')?.textContent).toBe('```');
  });

  it('hides both fences while the caret sits in the body', async () => {
    const mounted = mount(FENCED, '```js\n'.length);
    view = mounted.view;
    parent = mounted.parent;
    await settle();

    expect(codeLines(parent)).toEqual(['const count = 1;']);
    const line = parent.querySelector('.cm-line.q-md-code-line');
    expect(line?.classList.contains('q-md-code-line--first')).toBe(true);
    expect(line?.classList.contains('q-md-code-line--last')).toBe(true);
  });

  it('decorates a fenced block that scrolls into view in reading mode', async () => {
    const filler = Array.from({ length: 200 }, (_, index) => `paragraph ${index}`).join('\n\n');
    const doc = `${filler}\n\n${FENCED}\n`;
    const blockPos = doc.indexOf('```js');
    const mounted = mount(doc, doc.length, undefined, true);
    view = mounted.view;
    parent = mounted.parent;
    await settle();
    expect(codeLines(mounted.parent)).toEqual([]);

    view.dispatch({
      selection: { anchor: blockPos + 10 },
      effects: EditorView.scrollIntoView(blockPos, { y: 'start' }),
    });
    await settle();

    expect(codeLines(mounted.parent)).toEqual(['const count = 1;']);
  });

  it('hides fences in reading mode even when the saved caret is on the opening fence', async () => {
    const editable = new Compartment();
    const mounted = mount(FENCED, 0, editable);
    view = mounted.view;
    parent = mounted.parent;
    view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(false)) });
    await settle();

    expect(codeLines(mounted.parent)).toEqual(['const count = 1;']);
  });

  it('preserves ASCII diagram spaces while allowing visual wrapping', async () => {
    const diagram = ['```text', '┌──────────┐', '│  database  │', '└──────────┘', '```'].join('\n');
    const mounted = mount(diagram);
    view = mounted.view;
    parent = mounted.parent;
    await settle();

    const line = parent.querySelector<HTMLElement>('.cm-line.q-md-code-line');
    expect(line).not.toBeNull();
    expect(getComputedStyle(line!).whiteSpace).toBe('pre-wrap');
    expect(codeLines(parent)).toEqual(['┌──────────┐', '│  database  │', '└──────────┘', '```']);
    expect(view.state.doc.toString()).toBe(diagram);
  });

  it.each([
    ['', '', 'Plain text'],
    ['js', 'JavaScript', 'JavaScript'],
  ])('keeps language and copy controls available for a %s fence', async (language, value, label) => {
    const mounted = mount(['```' + language, 'body', '```'].join('\n'));
    view = mounted.view;
    parent = mounted.parent;
    await settle();

    const select = parent.querySelector<HTMLSelectElement>('.q-md-code-controls__language');
    const copy = parent.querySelector<HTMLButtonElement>('.q-md-code-controls__copy');
    expect(select?.value).toBe(value);
    expect(select?.selectedOptions[0]?.textContent).toBe(label);
    expect(copy?.textContent).toBe('Copy code');
    expect(copy?.disabled).toBe(false);
  });

  it.each(['', 'js'])('copies original spaces and long lines from a %s fence', async (language) => {
    copyText.mockResolvedValue(true);
    const body = '    aligned    columns\n' + 'longIdentifier'.repeat(40) + '\n  final  line';
    const doc = ['```' + language, body, '```'].join('\n');
    const mounted = mount(doc);
    view = mounted.view;
    parent = mounted.parent;
    await settle();

    parent.querySelector<HTMLButtonElement>('.q-md-code-controls__copy')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(copyText).toHaveBeenCalledExactlyOnceWith(body);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it('keeps the fences of an empty fenced block', async () => {
    const mounted = mount(EMPTY_FENCED, EMPTY_FENCED.length);
    view = mounted.view;
    parent = mounted.parent;
    await settle();

    expect(codeLines(parent).join('\n').match(/```/g)).toHaveLength(2);
  });

  it('hides the fences again after the caret leaves the opening line', async () => {
    const mounted = mount(FENCED, 0);
    view = mounted.view;
    parent = mounted.parent;
    await settle();
    expect(codeLines(parent)[0]).toBe('```js');

    view.dispatch({ selection: { anchor: '```js\n'.length } });
    await settle();

    expect(codeLines(parent)).toEqual(['const count = 1;']);
  });

  it('copies the body through the clipboard module and reports success', async () => {
    copyText.mockResolvedValue(true);
    const mounted = mount(FENCED, FENCED.length);
    view = mounted.view;
    parent = mounted.parent;
    await settle();

    const copy = parent.querySelector<HTMLButtonElement>('.q-md-code-controls__copy');
    expect(copy).not.toBeNull();
    copy?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settle();

    expect(copyText).toHaveBeenCalledWith('const count = 1;');
    expect(copy?.textContent).toBe('Copied');
    expect(copy?.classList.contains('q-md-code-controls__copy--copied')).toBe(true);

    await new Promise((r) => setTimeout(r, 1700));
    expect(copy?.textContent).toBe('Copy code');
    expect(copy?.classList.contains('q-md-code-controls__copy--copied')).toBe(false);
  });
});
