import { describe, expect, it } from 'vitest';
import { baseProperty } from './properties';
import type { BaseRow } from './types';

const root = '/vault';
const row: BaseRow = {
  path: '/vault/Projects/Tasks/A.md',
  fields: { status: 'doing', tags: ['project', 'rust'] },
};

describe('base property formatting', () => {
  it('derives file properties from the row path', () => {
    expect(baseProperty(row, 'file.name', root)).toBe('A');
    expect(baseProperty(row, 'file.path', root)).toBe('Projects/Tasks/A.md');
    expect(baseProperty(row, 'file.ext', root)).toBe('md');
    expect(baseProperty(row, 'file.folder', root)).toBe('Projects/Tasks');
  });

  it('reads frontmatter fields with and without the note prefix', () => {
    expect(baseProperty(row, 'status', root)).toBe('doing');
    expect(baseProperty(row, 'note.status', root)).toBe('doing');
    expect(baseProperty(row, 'tags', root)).toEqual(['project', 'rust']);
    expect(baseProperty(row, 'missing', root)).toBeUndefined();
  });
});
