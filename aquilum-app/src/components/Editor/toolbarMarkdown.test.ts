import { describe, expect, it } from 'vitest';
import { blockMarkdownEdits, inlineMarkdownEdit, type MarkdownEdit } from './toolbarMarkdown';

function applyEdits(source: string, edits: MarkdownEdit[]): string {
  return edits.slice().sort((a, b) => b.from - a.from).reduce((value, edit) => (
    value.slice(0, edit.from) + edit.insert + value.slice(edit.to)
  ), source);
}

describe('editing toolbar Markdown actions', () => {
  it('wraps and unwraps a selection, preserving the inner selection', () => {
    const wrapped = inlineMarkdownEdit('alpha', 0, 5, '**');
    expect(wrapped).toMatchObject({ insert: '**alpha**', anchor: 2, head: 7 });
    const undone = inlineMarkdownEdit('**alpha**', 2, 7, '**');
    expect(undone).toMatchObject({ from: 0, to: 9, insert: 'alpha' });
  });

  it('inserts paired markup and positions the caret between the markers', () => {
    expect(inlineMarkdownEdit('abc', 1, 1, '==')).toMatchObject({
      insert: '====', anchor: 3, head: 3,
    });
  });

  it('converts several lines into tasks and back without dropping text', () => {
    const markdown = 'first\nsecond\nthird';
    const tasks = applyEdits(markdown, blockMarkdownEdits(markdown, 0, 12, 'task'));
    expect(tasks).toBe('- [ ] first\n- [ ] second\nthird');
    expect(applyEdits(tasks, blockMarkdownEdits(tasks, 0, 25, 'task')))
      .toBe(markdown);
  });

  it('ignores the line after a selection ending on the newline boundary', () => {
    const markdown = 'one\ntwo';
    expect(applyEdits(markdown, blockMarkdownEdits(markdown, 0, 4, 'h2')))
      .toBe('## one\ntwo');
  });

  it('converts existing list markup to a heading without nesting prefixes', () => {
    const markdown = '- line';
    expect(applyEdits(markdown, blockMarkdownEdits(markdown, 0, 0, 'h1')))
      .toBe('# line');
  });

  it('supports all remaining Markdown heading levels', () => {
    expect(applyEdits('text', blockMarkdownEdits('text', 0, 4, 'h4'))).toBe('#### text');
    expect(applyEdits('text', blockMarkdownEdits('text', 0, 4, 'h5'))).toBe('##### text');
    expect(applyEdits('text', blockMarkdownEdits('text', 0, 4, 'h6'))).toBe('###### text');
  });
});
