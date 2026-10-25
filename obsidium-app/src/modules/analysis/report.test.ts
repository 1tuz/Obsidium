import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STALE_DAYS,
  MAX_STALE_DAYS,
  brokenLinkRow,
  clampStaleDays,
  emptyReport,
  filterRows,
  filterSection,
  reportSections,
  reportTotal,
  sortRows,
  staleNoteRow,
  unusedTagRow,
  type KnowledgeReport,
} from './report';

const populated: KnowledgeReport = {
  brokenLinks: [
    { sourcePath: '/vault/a.md', sourceTitle: 'a', target: 'Ghost', line: 3 },
    { sourcePath: '/vault/b.md', sourceTitle: 'b', target: 'Missing note', line: 7 },
  ],
  isolatedNotes: [{ path: '/vault/orphan.md', title: 'orphan' }],
  staleNotes: [
    { path: '/vault/old.md', title: 'old', modifiedNs: 1, days: 400 },
    { path: '/vault/older.md', title: 'older', modifiedNs: 0, days: 900 },
  ],
  unusedTags: {
    tags: [
      { tag: 'zeta', noteCount: 1, paths: ['/vault/z.md'] },
      { tag: 'alpha', noteCount: 1, paths: ['/vault/a.md'] },
    ],
    total: 2,
    truncated: false,
  },
  staleAfterDays: 90,
  indexedDocuments: 12,
  indexing: false,
};

describe('knowledge report sections', () => {
  it('counts every section and keeps the backend order', () => {
    const sections = reportSections(populated);

    expect(sections.map((section) => section.id)).toEqual([
      'brokenLinks',
      'isolatedNotes',
      'staleNotes',
      'unusedTags',
    ]);
    expect(sections.map((section) => section.count)).toEqual([2, 1, 2, 2]);
    expect(sections[0].rows.map((row) => row.title)).toEqual(['a', 'b']);
    expect(sections[2].rows.map((row) => row.detail)).toEqual(['900', '400']);
    expect(sections[3].rows.map((row) => row.title)).toEqual(['#alpha', '#zeta']);
  });

  it('reports no sections before the first response', () => {
    expect(reportSections(null)).toEqual([]);
    expect(reportTotal(null)).toBe(0);
  });

  it('sums the findings across sections', () => {
    expect(reportTotal(populated)).toBe(7);
    expect(reportTotal(emptyReport())).toBe(0);
  });

  it('orders every section on the client: titles ascending, stale notes by age', () => {
    const sections = reportSections({
      ...populated,
      brokenLinks: [
        { sourcePath: '/vault/z.md', sourceTitle: 'zeta', target: 'Ghost', line: 1 },
        { sourcePath: '/vault/a.md', sourceTitle: 'Alpha', target: 'Ghost', line: 9 },
        { sourcePath: '/vault/b.md', sourceTitle: 'alpha', target: 'Another', line: 2 },
      ],
      isolatedNotes: [
        { path: '/vault/b.md', title: 'beta' },
        { path: '/vault/a.md', title: 'Alpha' },
      ],
      staleNotes: [
        { path: '/vault/young.md', title: 'young', modifiedNs: 0, days: 120 },
        { path: '/vault/oldest.md', title: 'oldest', modifiedNs: 0, days: 900 },
      ],
    });

    expect(sections[0].rows.map((row) => row.title)).toEqual(['Alpha', 'alpha', 'zeta']);
    expect(sections[0].rows.map((row) => row.path)).toEqual(['/vault/a.md', '/vault/b.md', '/vault/z.md']);
    expect(sections[1].rows.map((row) => row.title)).toEqual(['Alpha', 'beta']);
    expect(sections[2].rows.map((row) => row.title)).toEqual(['oldest', 'young']);
  });

  it('sorts a copy and leaves the given rows untouched', () => {
    const rows = [
      { key: 'b', path: '/vault/b.md', title: 'b', detail: '' },
      { key: 'a', path: '/vault/a.md', title: 'a', detail: '' },
    ];

    expect(sortRows('isolatedNotes', rows).map((row) => row.key)).toEqual(['a', 'b']);
    expect(rows.map((row) => row.key)).toEqual(['b', 'a']);
  });

  it('gives every row a stable unique key', () => {
    const sections = reportSections(populated);
    const keys = sections.flatMap((section) => section.rows.map((row) => row.key));

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe('broken:/vault/a.md:3:Ghost:0');
    expect(keys[2]).toBe('isolated:/vault/orphan.md');
    expect(keys[5]).toBe('unusedTag:alpha');
    expect(brokenLinkRow(populated.brokenLinks[0], 0).path).toBe('/vault/a.md');
    expect(staleNoteRow(populated.staleNotes[0]).detail).toBe('400');
    expect(unusedTagRow(populated.unusedTags.tags[0])).toEqual({
      key: 'unusedTag:zeta',
      path: '/vault/z.md',
      title: '#zeta',
      detail: '/vault/z.md',
    });
  });

  it('reports the full tag total and the truncation flag', () => {
    const section = reportSections({
      ...populated,
      unusedTags: {
        tags: [{ tag: 'solo', noteCount: 1, paths: ['/vault/solo.md'] }],
        total: 150,
        truncated: true,
      },
    })[3];

    expect(section.count).toBe(150);
    expect(section.truncated).toBe(true);
    expect(section.rows.map((row) => row.title)).toEqual(['#solo']);
  });
});

describe('filtering entries', () => {
  it('matches the title, the detail and the path case-insensitively', () => {
    expect(filterRows(reportSections(populated)[0].rows, 'ghost')).toHaveLength(1);
    expect(filterRows(reportSections(populated)[0].rows, 'MISSING')).toHaveLength(1);
    expect(filterRows(reportSections(populated)[2].rows, '900')).toHaveLength(1);
    expect(filterRows(reportSections(populated)[1].rows, 'vault/orphan')).toHaveLength(1);
    expect(filterRows(reportSections(populated)[3].rows, '#zeta')).toHaveLength(1);
    expect(filterRows(reportSections(populated)[3].rows, 'z.md')).toHaveLength(1);
  });

  it('returns every row for a blank query without touching the original array', () => {
    const rows = reportSections(populated)[0].rows;
    const filtered = filterRows(rows, '   ');

    expect(filtered).toHaveLength(2);
    expect(filtered).not.toBe(rows);
  });

  it('keeps the section count but narrows the rows', () => {
    const section = filterSection(reportSections(populated)[0], 'nothing here');

    expect(section.count).toBe(2);
    expect(section.rows).toEqual([]);
  });
});

describe('stale window', () => {
  it('falls back to the default for missing or invalid values', () => {
    expect(clampStaleDays(undefined)).toBe(DEFAULT_STALE_DAYS);
    expect(clampStaleDays(null)).toBe(DEFAULT_STALE_DAYS);
    expect(clampStaleDays(0)).toBe(DEFAULT_STALE_DAYS);
    expect(clampStaleDays(-5)).toBe(DEFAULT_STALE_DAYS);
    expect(clampStaleDays(Number.NaN)).toBe(DEFAULT_STALE_DAYS);
    expect(clampStaleDays(Number.POSITIVE_INFINITY)).toBe(DEFAULT_STALE_DAYS);
  });

  it('rounds and bounds the accepted value', () => {
    expect(clampStaleDays(30)).toBe(30);
    expect(clampStaleDays(30.9)).toBe(30);
    expect(clampStaleDays(MAX_STALE_DAYS + 500)).toBe(MAX_STALE_DAYS);
  });

  it('seeds an empty report with the clamped window', () => {
    expect(emptyReport().staleAfterDays).toBe(DEFAULT_STALE_DAYS);
    expect(emptyReport(0).staleAfterDays).toBe(DEFAULT_STALE_DAYS);
    expect(emptyReport(45).staleAfterDays).toBe(45);
  });
});
