import { describe, expect, it } from 'vitest';
import {
  buildKanbanColumns,
  kanbanOrderWithCard,
  kanbanProperty,
  kanbanWritableProperty,
} from './kanban';
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

  it('orders cards by the stored cardOrder and keeps query order for the rest', () => {
    const ordered = buildKanbanColumns(rows, {
      ...view,
      cardOrder: { doing: ['C.md'] },
    }, root);
    expect(ordered[1].rows.map((row) => row.path)).toEqual(['/vault/C.md', '/vault/A.md']);
    expect(ordered[0].rows.map((row) => row.path)).toEqual(['/vault/B.md']);
  });

  it('appends cards missing from the stored order and drops deleted ones', () => {
    const ordered = buildKanbanColumns(rows, {
      ...view,
      cardOrder: { doing: ['Gone.md', 'A.md'] },
    }, root);
    expect(ordered[1].rows.map((row) => row.path)).toEqual(['/vault/A.md', '/vault/C.md']);
  });

  it('keeps query order when a column has no stored order', () => {
    const ordered = buildKanbanColumns(rows, { ...view, cardOrder: { todo: [] } }, root);
    expect(ordered[1].rows.map((row) => row.path)).toEqual(['/vault/A.md', '/vault/C.md']);
  });

  it('reports the WIP limit and flags a column that is over it', () => {
    const columns = buildKanbanColumns(rows, { ...view, wipLimits: { doing: 1, todo: 3 } }, root);
    expect(columns[1].limit).toBe(1);
    expect(columns[1].overLimit).toBe(true);
    expect(columns[0].limit).toBe(3);
    expect(columns[0].overLimit).toBe(false);
    expect(columns[2].limit).toBeUndefined();
    expect(columns[2].overLimit).toBe(false);
  });

  it('builds the order for a card dropped at a given index in another column', () => {
    const board = buildKanbanColumns(rows, view, root);
    const order = kanbanOrderWithCard(board, rows[1], 'doing', 1, root);
    expect(order).toEqual({
      doing: ['A.md', 'B.md', 'C.md'],
    });
  });

  it('moves a card inside its own column without shifting the requested index', () => {
    const board = buildKanbanColumns(rows, view, root);
    const order = kanbanOrderWithCard(board, rows[0], 'doing', 2, root);
    expect(order.doing).toEqual(['C.md', 'A.md']);
  });

  it('drops the card from its old column when it changes group', () => {
    const board = buildKanbanColumns(rows, view, root);
    const order = kanbanOrderWithCard(board, rows[0], 'done', 0, root);
    expect(order.doing).toEqual(['C.md']);
    expect(order.done).toEqual(['A.md']);
  });
});
