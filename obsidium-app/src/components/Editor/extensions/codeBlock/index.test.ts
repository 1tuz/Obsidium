// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorMarkdownSupport } from '../markdownConfig';
import { codeBlockExtension } from './index';

const copyText = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>());

vi.mock('../../../../modules/clipboard', () => ({ copyText }));

const FENCED = '```js\nconst count = 1;\n```';
const EMPTY_FENCED = '```js\n```';

function mount(doc: string, caret?: number) {
  const parent = document.createElement('div');
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: caret ?? doc.length },
      extensions: [editorMarkdownSupport, codeBlockExtension],
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
