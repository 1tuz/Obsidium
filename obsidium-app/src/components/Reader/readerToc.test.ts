import { describe, expect, it } from 'vitest';
import { flattenToc, tocItemLabel } from './readerToc';

describe('flattenToc', () => {
  it('flattens a nested tree in reading order with depth and hrefs', () => {
    const flat = flattenToc([
      {
        label: 'Part I',
        href: 'part1.xhtml',
        subitems: [
          { label: 'Chapter 1', href: 'ch1.xhtml' },
          {
            label: 'Chapter 2',
            href: ' ch2.xhtml ',
            subitems: [{ label: 'Section 2.1', href: null }],
          },
        ],
      },
      { label: 'Part II', href: null },
    ]);

    expect(flat).toEqual([
      { id: 0, label: 'Part I', href: 'part1.xhtml', depth: 0 },
      { id: 1, label: 'Chapter 1', href: 'ch1.xhtml', depth: 1 },
      { id: 2, label: 'Chapter 2', href: 'ch2.xhtml', depth: 1 },
      { id: 3, label: 'Section 2.1', href: null, depth: 2 },
      { id: 4, label: 'Part II', href: null, depth: 0 },
    ]);
  });

  it('keeps the ids the book supplies and gives the rest fresh ones', () => {
    const flat = flattenToc([
      { id: 0, label: 'One', href: 'one.xhtml' },
      { label: 'Two', href: 'two.xhtml' },
      { label: 'Three', href: 'three.xhtml' },
    ]);

    expect(flat.map((item) => item.id)).toEqual([0, 1, 2]);
    expect(flat.map((item) => item.label)).toEqual(['One', 'Two', 'Three']);
  });

  it('skips empty labels but keeps their children', () => {
    const flat = flattenToc([
      {
        label: '   ',
        href: 'skip.xhtml',
        subitems: [{ label: 'Child', href: 'child.xhtml' }],
      },
      { label: 'Second' },
    ]);

    expect(flat).toEqual([
      { id: 0, label: 'Child', href: 'child.xhtml', depth: 1 },
      { id: 1, label: 'Second', href: null, depth: 0 },
    ]);
  });

  it('tolerates missing input', () => {
    expect(flattenToc(null)).toEqual([]);
    expect(flattenToc(undefined)).toEqual([]);
    expect(flattenToc([])).toEqual([]);
  });
});

describe('tocItemLabel', () => {
  const items = flattenToc([
    { id: 4, label: 'Chapter 1', href: 'ch1.xhtml' },
    { id: 9, label: 'Chapter 2', href: 'ch2.xhtml' },
  ]);

  it('returns the label of the matching entry', () => {
    expect(tocItemLabel(items, 9)).toBe('Chapter 2');
  });

  it('returns an empty string for a missing or nullish id', () => {
    expect(tocItemLabel(items, 9999)).toBe('');
    expect(tocItemLabel(items, null)).toBe('');
    expect(tocItemLabel(items, undefined)).toBe('');
  });
});
