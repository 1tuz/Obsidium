import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  blocksInRanges,
  findBlockAt,
  scanBlocks,
  scanDocument,
  subtreeEnd,
  type BlockInfo,
} from './model';

function kinds(blocks: BlockInfo[]): string[] {
  return blocks.map((block) => block.kind);
}

describe('block scanning', () => {
  it('splits a document into top-level blocks with exact offsets', () => {
    const source = [
      '# Title',
      '',
      'First paragraph',
      'continues here.',
      '',
      '- one',
      '- two',
      '',
      '> quoted',
      '',
      '```ts',
      'const value = 1;',
      '```',
    ].join('\n');
    const blocks = scanBlocks(source);
    expect(kinds(blocks)).toEqual(['heading', 'paragraph', 'listItem', 'listItem', 'quote', 'code']);
    for (const block of blocks) {
      expect(source.slice(block.from, block.to)).toBe(block.text);
    }
    expect(blocks[0]!.level).toBe(1);
    expect(blocks[1]!.text).toBe('First paragraph\ncontinues here.');
    expect(blocks[2]!.listKind).toBe('bullet');
    expect(blocks[5]!.text).toBe('```ts\nconst value = 1;\n```');
  });

  it('recognises frontmatter, tables, dividers, tasks and block references', () => {
    const source = [
      '---',
      'title: Note',
      '---',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '---',
      '',
      '- [x] done ^task-ref',
    ].join('\n');
    const blocks = scanBlocks(source);
    expect(kinds(blocks)).toEqual(['frontmatter', 'table', 'hr', 'listItem']);
    expect(blocks[3]!.listKind).toBe('task');
    expect(blocks[3]!.ref).toBe('task-ref');
    expect(scanBlocks('text ^plain-ref')[0]!.ref).toBe('plain-ref');
  });

  it('tracks nesting levels of list items', () => {
    const source = ['- parent', '  - child', '    - grandchild', '- sibling'].join('\n');
    const blocks = scanBlocks(source);
    expect(blocks.map((block) => block.level)).toEqual([1, 2, 3, 1]);
    expect(blocks[1]!.indent).toBe('  ');
    expect(subtreeEnd(blocks, 0)).toBe(2);
    expect(subtreeEnd(blocks, 3)).toBe(3);
  });

  it('finds the block under a caret or a range', () => {
    const source = 'first\n\nsecond\n\nthird';
    const second = scanBlocks(source)[1]!;
    expect(findBlockAt(scanBlocks(source), second.from + 2)?.text).toBe('second');
    const selected = blocksInRanges(source, [{ from: 0, to: source.length }]);
    expect(selected.map((block) => block.text)).toEqual(['first', 'second', 'third']);
    const cursor = blocksInRanges(source, [{ from: second.from, to: second.from }]);
    expect(cursor.map((block) => block.text)).toEqual(['second']);
  });

  it('caches scans per CodeMirror document version', () => {
    const state = EditorState.create({ doc: 'one\n\ntwo' });
    const first = scanDocument(state.doc);
    expect(scanDocument(state.doc)).toBe(first);
    expect(first).toHaveLength(2);
  });
});

describe('fenced code boundaries', () => {
  it('keeps the fence open when the closer has trailing non-whitespace', () => {
    const source = '```\ncode\n```js\n# fake\n# real';
    const blocks = scanBlocks(source);
    expect(kinds(blocks)).toEqual(['code']);
    expect(blocks[0]!.text).toBe('```\ncode\n```js\n# fake\n# real');
    expect(findBlockAt(blocks, source.indexOf('# fake'))?.kind).toBe('code');
    expect(blocksInRanges(source, [{ from: source.indexOf('# fake'), to: source.indexOf('# fake') }])).toHaveLength(1);
  });

  it('keeps the fence open on a mismatched marker or a shorter closer', () => {
    for (const closer of ['```', '``']) {
      const source = `~~~\ncode\n${closer}\n# fake`;
      expect(kinds(scanBlocks(source))).toEqual(['code']);
    }
    const short = '````\ncode\n```\n# fake\n````';
    const blocks = scanBlocks(short);
    expect(kinds(blocks)).toEqual(['code']);
    expect(blocks[0]!.to).toBe(short.length);
  });

  it('closes on the same marker with at least the opener length and only whitespace after', () => {
    expect(kinds(scanBlocks('```\ncode\n```   \n# real'))).toEqual(['code', 'heading']);
    expect(kinds(scanBlocks('~~~\ncode\n~~~~~\n# real'))).toEqual(['code', 'heading']);
  });

  it('reports an unterminated fence up to the end of the document', () => {
    const source = '```\ncode\n# still code';
    expect(scanBlocks(source)[0]!.text).toBe(source);
  });
});
