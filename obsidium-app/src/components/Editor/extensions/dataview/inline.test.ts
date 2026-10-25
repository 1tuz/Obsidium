import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { editorMarkdownExtensions } from '../markdownConfig';
import { findInlineExpressions } from './inline';

function stateOf(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({ base: markdownLanguage, addKeymap: false, extensions: editorMarkdownExtensions }),
    ],
  });
}

function expressions(doc: string): { expr: string; text: string }[] {
  return findInlineExpressions(stateOf(doc)).map((found) => ({
    expr: found.expr,
    text: doc.slice(found.from, found.to),
  }));
}

describe('findInlineExpressions', () => {
  it('finds a value at the start of a line and in the middle of a sentence', () => {
    const doc = ['= file.name', '', 'Цена: = price * count'].join('\n');
    expect(expressions(doc)).toEqual([
      { expr: 'file.name', text: '= file.name' },
      { expr: 'price * count', text: '= price * count' },
    ]);
  });

  it('takes the expression up to the end of the line and drops trailing spaces', () => {
    const doc = 'Осталось = 10 - done   ';
    expect(expressions(doc)).toEqual([{ expr: '10 - done', text: '= 10 - done' }]);
  });

  it('needs a space after the equals sign', () => {
    expect(expressions('a =b')).toEqual([]);
    expect(expressions('a=b')).toEqual([]);
    expect(expressions('a == b')).toEqual([]);
  });

  it('ignores an empty expression', () => {
    expect(expressions('Итог: = ')).toEqual([]);
    expect(expressions('=')).toEqual([]);
  });

  it('ignores code spans, fences and links', () => {
    const doc = [
      'текст `= file.name`',
      '```dataview',
      '= file.name',
      '```',
      '```js',
      '= 1 + 1',
      '```',
      '[ссылка](https://example.com/= file.name)',
      '[[Заметка = file.name]]',
      '= 2 + 2',
    ].join('\n');
    expect(expressions(doc)).toEqual([{ expr: '2 + 2', text: '= 2 + 2' }]);
  });

  it('ignores the frontmatter', () => {
    const doc = ['---', 'formula: = 1 + 1', '---', '= 2 + 2'].join('\n');
    expect(expressions(doc)).toEqual([{ expr: '2 + 2', text: '= 2 + 2' }]);
  });

  it('reads one expression per line', () => {
    expect(expressions('= a = b')).toEqual([{ expr: 'a = b', text: '= a = b' }]);
  });
});
