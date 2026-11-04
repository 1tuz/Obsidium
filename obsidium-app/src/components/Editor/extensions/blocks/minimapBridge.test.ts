import { describe, expect, it } from 'vitest';
import { EditorState, Text } from '@codemirror/state';
import { activeHeadingIndex, minimapHeadings } from './minimapBridge';

function doc(source: string): Text {
  return EditorState.create({ doc: source }).doc;
}

describe('minimapHeadings', () => {
  it('collects headings with level, text, pos and ratio', () => {
    const source = '# Alpha\n\ntext\n\n## Beta\n\ntail';
    const headings = minimapHeadings(doc(source));
    expect(headings).toEqual([
      { level: 1, text: 'Alpha', pos: 0, ratio: 0 },
      { level: 2, text: 'Beta', pos: 15, ratio: 15 / source.length },
    ]);
  });

  it('ignores non-heading blocks and invalid levels', () => {
    const source = 'paragraph\n\n> # not a heading\n\n####### seven\n\n### Real\n';
    const headings = minimapHeadings(doc(source));
    expect(headings.map((heading) => heading.text)).toEqual(['Real']);
    expect(headings[0].level).toBe(3);
  });

  it('ignores headings inside fenced code blocks', () => {
    const headings = minimapHeadings(doc('```\n# inside\n```\n\n# outside'));
    expect(headings.map((heading) => heading.text)).toEqual(['outside']);
  });

  it('skips frontmatter headings', () => {
    const headings = minimapHeadings(doc('---\ntitle: x\n---\n\n# Title'));
    expect(headings.map((heading) => heading.text)).toEqual(['Title']);
    expect(headings[0].pos).toBe(18);
  });

  it('returns empty list for documents without headings', () => {
    expect(minimapHeadings(doc('plain text\n\nmore'))).toEqual([]);
    expect(minimapHeadings(Text.empty)).toEqual([]);
  });

  it('orders headings by document position with clamped increasing ratios', () => {
    const source = '# A\n## B\n### C\n#### D\n##### E\n###### F';
    const headings = minimapHeadings(doc(source));
    expect(headings.map((heading) => heading.level)).toEqual([1, 2, 3, 4, 5, 6]);
    const ratios = headings.map((heading) => heading.ratio);
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < ratios.length; i += 1) {
      expect(ratios[i]).toBeGreaterThan(ratios[i - 1]);
    }
  });

  it('uses the raw heading text for the label', () => {
    const headings = minimapHeadings(doc('## Beta ^ref'));
    expect(headings[0].text).toBe('Beta ^ref');
  });
});

describe('activeHeadingIndex', () => {
  const headings = minimapHeadings(doc('# One\n\n# Two\n\n# Three'));
  const tops = [0, 100, 200];

  it('returns -1 when no heading reached yet', () => {
    expect(activeHeadingIndex(headings, 0, [100, 200, 300])).toBe(-1);
    expect(activeHeadingIndex([], 100)).toBe(-1);
  });

  it('returns the last heading at or above the scroll line', () => {
    expect(activeHeadingIndex(headings, 0, tops)).toBe(0);
    expect(activeHeadingIndex(headings, 50, tops)).toBe(0);
  });

  it('applies the 24px active offset', () => {
    expect(activeHeadingIndex(headings, 80, tops)).toBe(1);
    expect(activeHeadingIndex(headings, 200, tops)).toBe(2);
    expect(activeHeadingIndex(headings, 176, tops)).toBe(2);
    expect(activeHeadingIndex(headings, 175, tops)).toBe(1);
  });

  it('stops at the first heading below the line even if later ones qualify', () => {
    const unordered = [
      { level: 1, text: 'a', pos: 0, ratio: 0.9 },
      { level: 1, text: 'b', pos: 1, ratio: 0.1 },
    ];
    expect(activeHeadingIndex(unordered, 0.5)).toBe(-1);
  });

  it('falls back to ratio comparison without tops', () => {
    expect(activeHeadingIndex(headings, 0.2)).toBe(0);
    expect(activeHeadingIndex(headings, 0.4)).toBe(1);
    expect(activeHeadingIndex(headings, 1)).toBe(2);
  });
});
