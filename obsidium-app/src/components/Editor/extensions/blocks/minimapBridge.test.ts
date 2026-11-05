import { describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { activeMarkIndex, compactMinimapMarks, minimapMarks, type MinimapMark } from './minimapBridge';

function doc(source: string): Text {
  return EditorState.create({ doc: source }).doc;
}

describe('minimapMarks', () => {
  it('collects all body block kinds with source positions and levels', () => {
    const source = '# Heading\n\nParagraph\n\n- item\n  - nested\n\n> quote\n\n> [!note] callout\n\n```\n# code\n```\n\n| A | B |\n| --- | --- |\n| a | b |\n\n---\n\n<!-- obsidium-sync:id -->';
    const marks = minimapMarks(doc(source));
    expect(marks.map((mark) => mark.kind)).toEqual([
      'heading', 'paragraph', 'listItem', 'listItem', 'quote', 'callout', 'code', 'table', 'hr', 'sync',
    ]);
    expect(marks[0]).toEqual({ kind: 'heading', level: 1, text: 'Heading', pos: 0, ratio: 0 });
    expect(marks[1]).toEqual({ kind: 'paragraph', level: 0, text: 'Paragraph', pos: 11, ratio: 11 / source.length });
    expect(marks[3].level).toBe(2);
    expect(marks.every((mark, index) => index === 0 || mark.pos > marks[index - 1].pos)).toBe(true);
  });

  it('skips frontmatter and keeps raw heading labels', () => {
    const marks = minimapMarks(doc('---\ntitle: x\n---\n\n## Title ^ref'));
    expect(marks).toEqual([{ kind: 'heading', level: 2, text: 'Title ^ref', pos: 18, ratio: 18 / 31 }]);
  });

  it('returns no marks for empty documents', () => {
    expect(minimapMarks(Text.empty)).toEqual([]);
    expect(minimapMarks(doc(' \n\n'))).toEqual([]);
  });
});

describe('compactMinimapMarks', () => {
  const marks: MinimapMark[] = [
    { kind: 'paragraph', level: 0, text: 'active', pos: 0, ratio: 0.1 },
    { kind: 'heading', level: 2, text: 'heading', pos: 10, ratio: 0.11 },
    { kind: 'code', level: 0, text: 'code', pos: 20, ratio: 0.12 },
    { kind: 'paragraph', level: 0, text: 'last', pos: 30, ratio: 1 },
  ];

  it('prioritizes headings per pixel and retains the active mark in document order', () => {
    expect(compactMinimapMarks(marks, 10, 0)).toEqual({ marks: [marks[0], marks[1], marks[3]], activeIndex: 0 });
    expect(compactMinimapMarks(marks, 10, 2)).toEqual({ marks: [marks[1], marks[2], marks[3]], activeIndex: 1 });
  });

  it('remaps the active index without duplicating an already retained mark', () => {
    expect(compactMinimapMarks(marks, 10, 1)).toEqual({ marks: [marks[1], marks[3]], activeIndex: 0 });
    expect(compactMinimapMarks(marks, 10, -1)).toEqual({ marks: [marks[1], marks[3]], activeIndex: -1 });
  });

  it('bounds dense output by pixel height plus the active mark', () => {
    const dense = Array.from({ length: 1000 }, (_, pos) => ({ ...marks[0], pos, ratio: pos / 999 }));
    expect(compactMinimapMarks(dense, 10, 500).marks.length).toBeLessThanOrEqual(11);
    expect(compactMinimapMarks([], 0, -1)).toEqual({ marks: [], activeIndex: -1 });
    expect(compactMinimapMarks(marks, 0, -1).marks).toEqual([marks[1]]);
  });
});

describe('activeMarkIndex', () => {
  const headings: MinimapMark[] = [0, 7, 14].map((pos) => ({ kind: 'heading', level: 1, text: '', pos, ratio: pos / 21 }));
  const tops = [0, 100, 200];

  it('returns -1 when no block reached yet', () => {
    expect(activeMarkIndex(headings, 0, [100, 200, 300])).toBe(-1);
    expect(activeMarkIndex([], 100)).toBe(-1);
  });

  it('returns the last block at or above the scroll line', () => {
    expect(activeMarkIndex(headings, 0, tops)).toBe(0);
    expect(activeMarkIndex(headings, 50, tops)).toBe(0);
  });

  it('applies the 24px active offset', () => {
    expect(activeMarkIndex(headings, 80, tops)).toBe(1);
    expect(activeMarkIndex(headings, 200, tops)).toBe(2);
    expect(activeMarkIndex(headings, 176, tops)).toBe(2);
    expect(activeMarkIndex(headings, 175, tops)).toBe(1);
  });

  it('stops at the first block below the line even if later ones qualify', () => {
    const unordered = [
      { kind: 'heading' as const, level: 1, text: 'a', pos: 0, ratio: 0.9 },
      { kind: 'heading' as const, level: 1, text: 'b', pos: 1, ratio: 0.1 },
    ];
    expect(activeMarkIndex(unordered, 0.5)).toBe(-1);
  });

  it('falls back to ratio comparison without tops', () => {
    expect(activeMarkIndex(headings, 0.2)).toBe(0);
    expect(activeMarkIndex(headings, 0.4)).toBe(1);
    expect(activeMarkIndex(headings, 1)).toBe(2);
  });
});
