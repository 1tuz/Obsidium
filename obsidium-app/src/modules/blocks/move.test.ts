import { describe, expect, it } from 'vitest';
import { scanBlocks } from './model';
import {
  blockSelection,
  deleteBlocks,
  duplicateBlocks,
  moveBlocks,
  type DropTarget,
} from './move';

function applyChange(source: string, change: { from: number; to: number; insert: string } | null): string {
  if (!change) return source;
  return source.slice(0, change.from) + change.insert + source.slice(change.to);
}

function block(source: string, index: number) {
  return scanBlocks(source)[index]!;
}

function drop(source: string, index: number, mode: 'before' | 'after' | 'inside'): DropTarget {
  return { mode, block: block(source, index) };
}

const DOC = ['alpha', '', 'beta', '', '- one', '- two', '', 'gamma'].join('\n');

describe('moveBlocks', () => {
  it('moves a block before another block', () => {
    const change = moveBlocks(DOC, [{ from: DOC.indexOf('gamma'), to: DOC.length }], drop(DOC, 0, 'before'));
    expect(applyChange(DOC, change)).toBe(['gamma', '', 'alpha', '', 'beta', '', '- one', '- two'].join('\n'));
  });

  it('moves a block after another block', () => {
    const change = moveBlocks(DOC, [{ from: 0, to: 'alpha'.length }], drop(DOC, 1, 'after'));
    expect(applyChange(DOC, change)).toBe(['beta', '', 'alpha', '', '- one', '- two', '', 'gamma'].join('\n'));
  });

  it('moves a paragraph inside a list item with two-space indent', () => {
    const change = moveBlocks(DOC, [{ from: 0, to: 'alpha'.length }], drop(DOC, 2, 'inside'));
    expect(applyChange(DOC, change)).toBe(['beta', '', '- one\n  alpha', '- two', '', 'gamma'].join('\n'));
  });

  it('moves a paragraph inside a quote with quote prefix', () => {
    const source = ['para', '', '> quote', '', 'after'].join('\n');
    const change = moveBlocks(source, [{ from: 0, to: 4 }], drop(source, 1, 'inside'));
    expect(applyChange(source, change)).toBe(['> quote', '  > para', '', 'after'].join('\n'));
  });

  it('moves a nested subtree including descendants', () => {
    const source = ['- parent', '  - child', '  - child2', '- sibling'].join('\n');
    const change = moveBlocks(source, [{ from: 0, to: '- parent'.length }], drop(source, 3, 'after'));
    expect(applyChange(source, change)).toBe(['- sibling', '- parent', '  - child', '  - child2'].join('\n'));
  });

  it('moves multiple non-contiguous ranges preserving order', () => {
    const source = ['one', '', 'two', '', 'three', '', 'four'].join('\n');
    const gammaLike = source.indexOf('three');
    const change = moveBlocks(
      source,
      [
        { from: 0, to: 3 },
        { from: gammaLike, to: gammaLike + 5 },
      ],
      drop(source, 3, 'after'),
    );
    expect(applyChange(source, change)).toBe(['two', '', 'four', '', 'one', '', 'three'].join('\n'));
  });

  it('rejects dropping a block into its own selection', () => {
    const change = moveBlocks(DOC, [{ from: 0, to: 5 }], drop(DOC, 0, 'before'));
    expect(change).toBeNull();
  });

  it('rejects dropping inside a selected subtree', () => {
    const source = ['- parent', '  - child', '', 'para'].join('\n');
    const change = moveBlocks(source, [{ from: 0, to: 9 }], drop(source, 1, 'inside'));
    expect(change).toBeNull();
  });

  it('rejects inside drop onto a non-container', () => {
    const change = moveBlocks(DOC, [{ from: 0, to: 5 }], drop(DOC, 1, 'inside'));
    expect(change).toBeNull();
  });

  it('preserves block references while moving', () => {
    const source = ['one ^ref-a', '', 'two', '', 'three'].join('\n');
    const change = moveBlocks(source, [{ from: 0, to: 'one ^ref-a'.length }], drop(source, 1, 'after'));
    expect(applyChange(source, change)).toBe(['two', '', 'one ^ref-a', '', 'three'].join('\n'));
  });
});

describe('duplicateBlocks', () => {
  it('duplicates selection after the last block', () => {
    const change = duplicateBlocks(DOC, [{ from: DOC.indexOf('- one'), to: DOC.indexOf('gamma') }]);
    expect(applyChange(DOC, change)).toBe(
      ['alpha', '', 'beta', '', '- one', '- two', '- one', '- two', '', 'gamma'].join('\n'),
    );
  });
});

describe('deleteBlocks', () => {
  it('removes selection with the trailing newline', () => {
    const change = deleteBlocks(DOC, [{ from: 0, to: 'alpha'.length }]);
    expect(applyChange(DOC, change)).toBe(['beta', '', '- one', '- two', '', 'gamma'].join('\n'));
  });

  it('removes the last block without leaving a dangling newline', () => {
    const change = deleteBlocks(DOC, [{ from: DOC.indexOf('gamma'), to: DOC.length }]);
    expect(applyChange(DOC, change)).toBe(['alpha', '', 'beta', '', '- one', '- two'].join('\n'));
  });
});

describe('blockSelection', () => {
  it('expands a list item range to its subtree', () => {
    const source = ['- parent', '  - child', '- other', '', 'para'].join('\n');
    const selection = blockSelection(source, [{ from: 0, to: '- parent'.length }]);
    expect(selection.map((entry) => entry.text)).toEqual(['- parent', '  - child']);
  });

  it('returns blocks sorted by document order', () => {
    const selection = blockSelection('one\n\ntwo\n\nthree', [
      { from: 'one\n\ntwo\n\nthree'.indexOf('three'), to: 'one\n\ntwo\n\nthree'.length },
      { from: 0, to: 3 },
    ]);
    expect(selection.map((entry) => entry.text)).toEqual(['one', 'three']);
  });
});
