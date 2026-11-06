import { describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { activeMarkIndex, minimapMarks, type MinimapMark } from './minimapBridge';

function doc(source: string): Text {
  return EditorState.create({ doc: source }).doc;
}

describe('minimapMarks', () => {
  it('collects only headings with source positions, levels and heading text', () => {
    const source = '# Heading\n\nParagraph\n\n- item\n  - nested\n\n> quote\n\n> [!note] callout\n\n```\n# code\n```\n\n| A | B |\n| --- | --- |\n| a | b |\n\n---\n\n<!-- obsidium-sync:id -->';
    expect(minimapMarks(doc(source))).toEqual([{ level: 1, text: 'Heading', pos: 0 }]);
  });

  it('keeps every heading level and skips other block kinds', () => {
    const source = '# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F\n\n- item';
    const marks = minimapMarks(doc(source));
    expect(marks.map((mark) => [mark.level, mark.text])).toEqual([
      [1, 'A'], [2, 'B'], [3, 'C'], [4, 'D'], [5, 'E'], [6, 'F'],
    ]);
    expect(marks.map((mark) => mark.pos)).toEqual([...marks].sort((a, b) => a.pos - b.pos).map((mark) => mark.pos));
  });

  it('skips frontmatter and keeps raw heading labels', () => {
    expect(minimapMarks(doc('---\ntitle: x\n---\n\n## Title ^ref'))).toEqual([
      { level: 2, text: 'Title ^ref', pos: 18 },
    ]);
  });

  it('returns no marks for documents without headings', () => {
    expect(minimapMarks(Text.empty)).toEqual([]);
    expect(minimapMarks(doc(' \n\nParagraph only\n'))).toEqual([]);
  });
});

describe('activeMarkIndex', () => {
  const headings: MinimapMark[] = [0, 7, 14].map((pos) => ({ level: 1, text: '', pos }));
  const tops = [0, 100, 200];

  it('returns -1 when no heading top reached the active offset yet', () => {
    expect(activeMarkIndex(headings, 0, [100, 200, 300])).toBe(-1);
    expect(activeMarkIndex([], 100, [])).toBe(-1);
  });

  it('returns the last heading at or above the scroll line', () => {
    expect(activeMarkIndex(headings, 0, tops)).toBe(0);
    expect(activeMarkIndex(headings, 50, tops)).toBe(0);
  });

  it('applies the active offset to the scroll line', () => {
    expect(activeMarkIndex(headings, 80, tops)).toBe(1);
    expect(activeMarkIndex(headings, 200, tops)).toBe(2);
    expect(activeMarkIndex(headings, 176, tops)).toBe(2);
    expect(activeMarkIndex(headings, 175, tops)).toBe(1);
  });

  it('stops at the first heading below the line even if later ones qualify', () => {
    expect(activeMarkIndex(headings, 250, [0, 300, 100])).toBe(0);
  });
});
