import { describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { codeBlocks, codeLanguageChange } from './blocks';
import { editorMarkdownExtensions } from '../markdownConfig';

function blocks(doc: string) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage, addKeymap: false, extensions: editorMarkdownExtensions })],
  });
  return codeBlocks(syntaxTree(state), state.doc, [{ from: 0, to: doc.length }]);
}

const FENCED = [
  'текст',
  '',
  '```js',
  'const a = 1;',
  'const b = 2;',
  '```',
  '',
].join('\n');

describe('code blocks', () => {
  it('spans a fenced block from its opening line to the end of its closing line', () => {
    expect(blocks(FENCED)).toEqual([{
      from: 7,
      end: 42,
      info: 'js',
      infoFrom: 10,
      contentFrom: 13,
      contentTo: 39,
      fenced: true,
    }]);
  });

  it('extracts only the code body and inserts a language before fence attributes', () => {
    const doc = ['``` title=example', 'const x = 1;', '```', ''].join('\n');
    const block = blocks(doc)[0]!;
    expect(block.info).toBe('title=example');
    expect(doc.slice(block.contentFrom, block.contentTo)).toBe('const x = 1;\n');
    expect(codeLanguageChange(block, 'js')).toEqual({
      from: block.infoFrom,
      to: block.infoFrom,
      insert: 'js ',
    });
  });

  it('replaces a language token without changing following fence metadata', () => {
    const block = blocks(['```js title=example', 'code', '```'].join('\n'))[0]!;
    expect(codeLanguageChange(block, 'python')).toEqual({
      from: block.infoFrom,
      to: block.infoFrom + 2,
      insert: 'python',
    });
  });

  it('clears a recognized language without deleting a fence attribute', () => {
    const block = blocks(['```js title=example', 'code', '```'].join('\n'))[0]!;
    expect(codeLanguageChange(block, '')).toEqual({
      from: block.infoFrom,
      to: block.infoFrom + 2,
      insert: '',
    });
    const attributesOnly = blocks(['```title=example', 'code', '```'].join('\n'))[0]!;
    expect(codeLanguageChange(attributesOnly, '')).toEqual({
      from: attributesOnly.infoFrom,
      to: attributesOnly.infoFrom,
      insert: '',
    });
  });

  it('leaves prose and inline code alone', () => {
    expect(blocks('обычный `код` в тексте')).toEqual([]);
  });

  it('stops at the last line of a block whose fence is not closed yet', () => {
    expect(blocks('```\n')).toEqual([{
      from: 0,
      end: 3,
      info: '',
      infoFrom: 3,
      contentFrom: 4,
      contentTo: 4,
      fenced: true,
    }]);
  });

  it('covers an indented code block too', () => {
    expect(blocks('\tcode\n')).toEqual([{
      from: 0,
      end: 5,
      info: '',
      infoFrom: 5,
      contentFrom: 0,
      contentTo: 5,
      fenced: false,
    }]);
  });

  it('keeps two adjacent blocks apart', () => {
    const doc = ['```js', 'a', '```', '```py', 'b', '```', ''].join('\n');
    expect(blocks(doc)).toMatchObject([{ from: 0, end: 11, info: 'js' }, { from: 12, end: 23, info: 'py' }]);
  });
});
