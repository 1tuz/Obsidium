// @vitest-environment happy-dom
import { syntaxHighlighting } from '@codemirror/language';
import { describe, expect, it, vi } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { outlineMarkdownConfig } from '../outline';
import { markdownStyles } from '../theme';
import { linkInteraction, markdownNoteTarget, readerRefLinkClickAllowed } from './interaction';
import { wikiLinkMarkdownConfig } from './syntax';

const USER_QUOTE = '> [!quote] Вот примерно таким было бы наше восприятие мира всегда, если бы не ретикулярная формация. В данном примере она уже пробудила вас, но ещё не включилась на полную мощь и не успела выполнить свою интегрирующую функцию. [3](aquilum-reader:book=Files%2Ftest.fb2&cfi=epubcfi%28%2F6%2F10%29)';

function createState(doc: string, head: number) {
  return EditorState.create({
    doc,
    selection: EditorSelection.cursor(head),
    extensions: [
      markdown({
        base: markdownLanguage,
        extensions: [outlineMarkdownConfig, wikiLinkMarkdownConfig],
      }),
    ],
  });
}

describe('readerRefLinkClickAllowed', () => {
  const doc = '> [!quote] Quote text [1](aquilum-reader:cfi=abc&book=files%2Flong%2Fpath)\nafter\n';
  const refStart = doc.indexOf('[1]');
  const urlMid = doc.indexOf('aquilum-reader') + 10;
  const quoteMid = doc.indexOf('Quote') + 2;
  const url = 'aquilum-reader:cfi=abc';

  it('blocks click on ref while caret is in quote text', () => {
    const state = createState(doc, quoteMid);
    expect(readerRefLinkClickAllowed(state, refStart, url)).toBe(false);
  });

  it('blocks click on url while caret is in quote text', () => {
    const state = createState(doc, quoteMid);
    expect(readerRefLinkClickAllowed(state, urlMid, url)).toBe(false);
  });

  it('allows click on ref only when caret is on the label', () => {
    const state = createState(doc, refStart + 1);
    expect(readerRefLinkClickAllowed(state, refStart + 1, url)).toBe(true);
  });

  it('allows normal external links', () => {
    const plain = 'see [web](https://example.com)\n';
    const state = createState(plain, plain.indexOf('web'));
    expect(readerRefLinkClickAllowed(state, plain.indexOf('web'), 'https://example.com')).toBe(true);
  });

  it('blocks reader ref in long quote while caret is in text', () => {
    const mid = USER_QUOTE.indexOf('ретикулярная') + 4;
    const ref = USER_QUOTE.indexOf('[3]') + 1;
    const state = createState(`${USER_QUOTE}\nafter`, mid);
    expect(readerRefLinkClickAllowed(state, ref, 'aquilum-reader:book=Files%2Ftest.fb2&cfi=x')).toBe(false);
  });
});

describe('markdownNoteTarget', () => {
  it('resolves a sibling Markdown link from the current note', () => {
    expect(markdownNoteTarget('AGENTS.md', '/vault', '/vault/HERMES.md')).toBe('AGENTS.md');
  });

  it('normalizes a parent-relative Markdown link inside the workspace', () => {
    expect(markdownNoteTarget('../AGENTS.md', '/vault', '/vault/Guides/HERMES.md'))
      .toBe('AGENTS.md');
  });

  it('decodes URL paths and ignores fragments when selecting the note', () => {
    expect(markdownNoteTarget('./Guides/Support%20Rules.md#Access', '/vault', '/vault/HERMES.md'))
      .toBe('Guides/Support Rules.md');
  });

  it('resolves a root-relative Markdown link from the workspace root', () => {
    expect(markdownNoteTarget('/AGENTS.md', '/vault', '/vault/Guides/HERMES.md'))
      .toBe('AGENTS.md');
  });

  it('does not resolve links outside the workspace', () => {
    expect(markdownNoteTarget('../../AGENTS.md', '/vault', '/vault/HERMES.md')).toBeNull();
  });

  it('leaves web and non-Markdown links to their existing handlers', () => {
    expect(markdownNoteTarget('https://example.com/AGENTS.md', '/vault', '/vault/HERMES.md')).toBeNull();
    expect(markdownNoteTarget('image.png', '/vault', '/vault/HERMES.md')).toBeNull();
    expect(markdownNoteTarget('AGENTS%ZZ.md', '/vault', '/vault/HERMES.md')).toBeNull();
  });
});

describe('linkInteraction', () => {
  it('opens a relative Markdown note through internal navigation', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const onOpenWiki = vi.fn();
    const onOpenExternal = vi.fn();
    const view = new EditorView({
      state: EditorState.create({
        doc: '[AGENTS.md](AGENTS.md)',
        extensions: [
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(markdownStyles),
          linkInteraction(onOpenWiki, onOpenExternal, '/vault', () => '/vault/HERMES.md'),
        ],
      }),
      parent,
    });
    vi.spyOn(view, 'posAtCoords').mockReturnValue(2);
    const link = parent.querySelector<HTMLElement>('.q-md-link');

    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));

    expect(onOpenWiki).toHaveBeenCalledWith('AGENTS.md', 'current');
    expect(onOpenExternal).not.toHaveBeenCalled();
    view.destroy();
    parent.remove();
  });
});
