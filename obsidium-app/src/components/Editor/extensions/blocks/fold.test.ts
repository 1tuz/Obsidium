// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { foldCode, foldable, foldedRanges } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { blockFoldExtension, blockFoldRange } from './fold';

function state(source: string): EditorState {
  return EditorState.create({ doc: source, extensions: [blockFoldExtension()] });
}

function lineStart(source: string, line: number): number {
  const lines = source.split('\n');
  return lines.slice(0, line - 1).reduce((sum, entry) => sum + entry.length + 1, 0);
}

describe('blockFoldRange', () => {
  it('folds a heading section through deeper subsections to the next heading of the same level', () => {
    const source = '# One\n\nbody\n\n## Two\n\ntail';
    expect(blockFoldRange(state(source), 0)).toEqual({ from: 5, to: source.length });
  });

  it('folds an inner heading section up to the next heading boundary', () => {
    const source = '# One\n\nbody\n\n## Two\n\ntail\n\n# Three';
    const heading = source.indexOf('## Two');
    const sectionEnd = source.indexOf('tail') + 'tail'.length;
    expect(blockFoldRange(state(source), heading)).toEqual({ from: heading + '## Two'.length, to: sectionEnd });
    expect(blockFoldRange(state(source), 0)).toEqual({ from: 5, to: sectionEnd });
  });

  it('skips headings immediately followed by a heading of the same or higher level', () => {
    const source = '# One\n\n# Two\n\ntail';
    expect(blockFoldRange(state(source), 0)).toBeNull();
    expect(blockFoldRange(state(source), source.indexOf('# Two'))).not.toBeNull();
  });

  it('includes a trailing empty section heading inside the parent fold', () => {
    const source = '# One\n\n## Two';
    expect(blockFoldRange(state(source), 0)).toEqual({ from: 5, to: source.length });
    expect(blockFoldRange(state(source), source.indexOf('## Two'))).toBeNull();
  });

  it('folds a closed toggle callout body', () => {
    const source = '> [!note]- Title\n> body line';
    expect(blockFoldRange(state(source), 0))
      .toEqual({ from: source.indexOf('\n'), to: source.length });
  });

  it('does not fold open callouts', () => {
    const source = '> [!note] Title\n> body line';
    expect(blockFoldRange(state(source), 0)).toBeNull();
  });

  it('folds a code fence between the opening and closing fence lines', () => {
    const source = '```js\nconst a = 1;\nconst b = 2;\n```';
    expect(blockFoldRange(state(source), 0))
      .toEqual({ from: '```js'.length, to: source.length - '```'.length - 1 });
  });

  it('never folds empty ranges or unterminated fences', () => {
    expect(blockFoldRange(state('```\ncode'), 0)).toBeNull();
    expect(blockFoldRange(state('```'), 0)).toBeNull();
    expect(blockFoldRange(state('> [!note]- Title'), 0)).toBeNull();
  });

  it('does not fold paragraphs, tables or frontmatter', () => {
    const source = '---\ntitle: x\n---\n\n| A | B |\n| --- | --- |\n| a | b |\n\nplain text';
    const doc = state(source);
    for (const line of [1, 5, 6, 7, 9]) {
      expect(blockFoldRange(doc, lineStart(source, line))).toBeNull();
    }
  });
});

describe('blockFoldExtension foldService', () => {
  it('exposes heading folds through foldable()', () => {
    const source = '# One\n\nbody\n\n## Two';
    expect(foldable(state(source), 0, 5)).toEqual({ from: 5, to: source.length });
  });

  it('folds a heading section via the foldCode command', () => {
    const source = '# One\n\nbody\n\n## Two';
    const view = new EditorView({
      state: state(source),
      parent: document.body,
    });
    view.dispatch({ selection: EditorSelection.cursor(0) });
    expect(foldCode(view)).toBe(true);
    const folded = foldedRanges(view.state);
    let seen: { from: number; to: number } | null = null;
    folded.between(0, source.length, (from, to) => { seen = { from, to }; });
    expect(seen).toEqual({ from: 5, to: source.length });
    view.destroy();
  });
});
