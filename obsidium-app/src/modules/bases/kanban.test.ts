import { describe, expect, it } from 'vitest';
import { buildKanbanColumns, kanbanProperty, kanbanWritableProperty } from './kanban';
import type { BaseRow, BaseViewDefinition } from './types';

const root = '/vault';
const rows: BaseRow[] = [
  { path: '/vault/A.md', fields: { status: 'doing' } },
  { path: '/vault/B.md', fields: { status: 'todo' } },
  { path: '/vault/C.md', fields: { status: 'doing' } },
];

const view: BaseViewDefinition = {
  type: 'kanban',
  name: 'Board',
  order: ['file.name', 'priority'],
  groupBy: { property: 'status', direction: 'ASC' },
  groupOrder: ['todo', 'doing', 'done'],
};

describe('kanban bases view', () => {
  it('keeps configured empty columns and places rows in their group', () => {
    const columns = buildKanbanColumns(rows, view, root);
    expect(columns.map((column) => column.value)).toEqual(['todo', 'doing', 'done']);
    expect(columns[1].rows.map((row) => row.path)).toEqual(['/vault/A.md', '/vault/C.md']);
    expect(columns[2].rows).toEqual([]);
  });

  it('keeps configured columns when the base has no rows', () => {
    expect(buildKanbanColumns([], view, root).map((column) => column.value)).toEqual([
      'todo', 'doing', 'done',
    ]);
  });

  it('falls back to status when a kanban view has no explicit groupBy', () => {
    expect(kanbanProperty({ ...view, groupBy: undefined })).toBe('status');
  });

  it('only allows drag-and-drop onto note properties', () => {
    expect(kanbanWritableProperty('status')).toBe(true);
    expect(kanbanWritableProperty('note.status')).toBe(true);
    expect(kanbanWritableProperty('file.folder')).toBe(false);
    expect(kanbanWritableProperty('formula.score')).toBe(false);
  });
});
