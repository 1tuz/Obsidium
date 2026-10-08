import { describe, expect, it } from 'vitest';
import { evaluateBaseFilter, sortBaseRows } from './filter';
import type { BaseRow } from './types';

const root = '/vault';
const rows: BaseRow[] = [
  { path: '/vault/Projects/A.md', fields: { status: 'doing', priority: '2', tags: ['project', 'rust'] } },
  { path: '/vault/Projects/B.md', fields: { status: 'done', priority: '10', tags: ['archive'] } },
];

describe('base filtering', () => {
  it('supports recursive filters and file helpers', () => {
    const result = evaluateBaseFilter({ and: [
      'status != "done"',
      'file.hasTag("project")',
      'file.inFolder("Projects")',
    ] }, rows[0], root);
    expect(result).toEqual({ match: true, unsupported: false });
  });

  it('keeps rows visible for unknown expressions and reports them', () => {
    const result = evaluateBaseFilter('formula.score > 5', rows[0], root);
    expect(result).toEqual({ match: true, unsupported: true });
  });

  it('sorts numeric fields numerically', () => {
    expect(sortBaseRows(rows, [{ property: 'priority', direction: 'DESC' }], root)[0].path)
      .toContain('B.md');
  });
});
