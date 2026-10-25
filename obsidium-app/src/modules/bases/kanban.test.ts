import { describe, expect, it } from 'vitest';
import {
  buildKanbanBoard,
  kanbanCell,
  kanbanCells,
  kanbanLaneProperty,
  kanbanOrderKey,
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

function titles(cell: { rows: BaseRow[] } | undefined): string[] {
  return cell ? cell.rows.map((row) => row.path) : [];
}

describe('kanban bases view', () => {
  it('keeps configured empty columns and places rows in their group', () => {
    const board = buildKanbanBoard(rows, view, root);
    expect(board.columnValues).toEqual(['todo', 'doing', 'done']);
    expect(titles(kanbanCell(board, '', 'doing'))).toEqual(['/vault/A.md', '/vault/C.md']);
    expect(titles(kanbanCell(board, '', 'done'))).toEqual([]);
  });

  it('keeps configured columns when the base has no rows', () => {
    expect(buildKanbanBoard([], view, root).columnValues).toEqual(['todo', 'doing', 'done']);
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

  it('draws a single lane and keys the order by column when laneBy is absent', () => {
    const board = buildKanbanBoard(rows, view, root);
    expect(board.laneProperty).toBeNull();
    expect(board.laneValues).toEqual(['']);
    expect(board.lanes).toHaveLength(1);
    expect(kanbanCells(board).map((cell) => cell.key))
      .toEqual(['todo', 'doing', 'done']);
  });

  it('orders cards by the stored cardOrder and keeps query order for the rest', () => {
    const board = buildKanbanBoard(rows, {
      ...view,
      cardOrder: { doing: ['C.md'] },
    }, root);
    expect(titles(kanbanCell(board, '', 'doing'))).toEqual(['/vault/C.md', '/vault/A.md']);
    expect(titles(kanbanCell(board, '', 'todo'))).toEqual(['/vault/B.md']);
  });

  it('appends cards missing from the stored order and drops deleted ones', () => {
    const board = buildKanbanBoard(rows, {
      ...view,
      cardOrder: { doing: ['Gone.md', 'A.md'] },
    }, root);
    expect(titles(kanbanCell(board, '', 'doing'))).toEqual(['/vault/A.md', '/vault/C.md']);
  });

  it('keeps query order when a column has no stored order', () => {
    const board = buildKanbanBoard(rows, { ...view, cardOrder: { todo: [] } }, root);
    expect(titles(kanbanCell(board, '', 'doing'))).toEqual(['/vault/A.md', '/vault/C.md']);
  });

  it('reports the WIP limit and flags a column that is over it', () => {
    const board = buildKanbanBoard(rows, { ...view, wipLimits: { doing: 1, todo: 3 } }, root);
    const doing = kanbanCell(board, '', 'doing')!;
    expect(doing.limit).toBe(1);
    expect(doing.overLimit).toBe(true);
    const todo = kanbanCell(board, '', 'todo')!;
    expect(todo.limit).toBe(3);
    expect(todo.overLimit).toBe(false);
    const done = kanbanCell(board, '', 'done')!;
    expect(done.limit).toBeUndefined();
    expect(done.overLimit).toBe(false);
  });

  it('builds the order for a card dropped at a given index in another column', () => {
    const board = buildKanbanBoard(rows, view, root);
    const order = kanbanOrderWithCard(
      kanbanCells(board), rows[1], kanbanCell(board, '', 'doing')!, 1, root,
    );
    expect(order).toEqual({
      doing: ['A.md', 'B.md', 'C.md'],
    });
  });

  it('moves a card inside its own column without shifting the requested index', () => {
    const board = buildKanbanBoard(rows, view, root);
    const order = kanbanOrderWithCard(
      kanbanCells(board), rows[0], kanbanCell(board, '', 'doing')!, 2, root,
    );
    expect(order.doing).toEqual(['C.md', 'A.md']);
  });

  it('drops the card from its old column when it changes group', () => {
    const board = buildKanbanBoard(rows, view, root);
    const order = kanbanOrderWithCard(
      kanbanCells(board), rows[0], kanbanCell(board, '', 'done')!, 0, root,
    );
    expect(order.doing).toEqual(['C.md']);
    expect(order.done).toEqual(['A.md']);
  });
});

describe('kanban swimlanes', () => {
  const laneView: BaseViewDefinition = {
    ...view,
    laneBy: { property: 'owner', direction: 'ASC' },
    laneOrder: ['Ada', 'Bob'],
  };
  const laneRows: BaseRow[] = [
    { path: '/vault/A.md', fields: { status: 'doing', owner: 'Ada' } },
    { path: '/vault/B.md', fields: { status: 'todo', owner: 'Ada' } },
    { path: '/vault/C.md', fields: { status: 'doing', owner: 'Bob' } },
    { path: '/vault/D.md', fields: { status: 'todo' } },
  ];

  it('groups rows along both axes', () => {
    const board = buildKanbanBoard(laneRows, laneView, root);

    expect(board.laneProperty).toBe('owner');
    expect(kanbanLaneProperty(laneView)).toBe('owner');
    expect(board.laneValues).toEqual(['Ada', 'Bob', '']);
    expect(board.columnValues).toEqual(['todo', 'doing', 'done']);
    expect(board.lanes.map((lane) => lane.cells.length)).toEqual([3, 3, 3]);
    expect(titles(kanbanCell(board, 'Ada', 'doing'))).toEqual(['/vault/A.md']);
    expect(titles(kanbanCell(board, 'Bob', 'doing'))).toEqual(['/vault/C.md']);
    expect(titles(kanbanCell(board, '', 'todo'))).toEqual(['/vault/D.md']);
    expect(titles(kanbanCell(board, 'Ada', 'done'))).toEqual([]);
  });

  it('keeps configured lanes empty and sorts unknown lanes alphabetically with numbers', () => {
    const board = buildKanbanBoard([
      { path: '/vault/Ten.md', fields: { status: 'todo', owner: 'Team 10' } },
      { path: '/vault/Two.md', fields: { status: 'todo', owner: 'Team 2' } },
    ], { ...laneView, laneOrder: ['Ada'] }, root);

    expect(board.laneValues).toEqual(['Ada', 'Team 2', 'Team 10']);
    expect(titles(kanbanCell(board, 'Ada', 'todo'))).toEqual([]);
  });

  it('reverses the observed lane order for a DESC direction', () => {
    const board = buildKanbanBoard(laneRows, {
      ...laneView,
      laneOrder: [],
      laneBy: { property: 'owner', direction: 'DESC' },
    }, root);

    expect(board.laneValues).toEqual(['Bob', 'Ada', '']);
  });

  it('keys the card order and the WIP limit by the lane and the column', () => {
    const board = buildKanbanBoard(laneRows, {
      ...laneView,
      cardOrder: {
        [kanbanOrderKey('Bob', 'doing')]: ['C.md'],
        [kanbanOrderKey('Ada', 'todo')]: ['B.md'],
      },
      wipLimits: { [kanbanOrderKey('Ada', 'doing')]: 1 },
    }, root);

    expect(kanbanCell(board, 'Bob', 'doing')!.key).toBe('Bob / doing');
    expect(kanbanCell(board, 'Ada', 'doing')!.limit).toBe(1);
    expect(kanbanCell(board, 'Ada', 'todo')!.rows.map((row) => row.path))
      .toEqual(['/vault/B.md']);
  });

  it('orders the cards of one lane without touching the other lane', () => {
    const board = buildKanbanBoard([
      { path: '/vault/A.md', fields: { status: 'doing', owner: 'Ada' } },
      { path: '/vault/B.md', fields: { status: 'doing', owner: 'Ada' } },
      { path: '/vault/C.md', fields: { status: 'doing', owner: 'Bob' } },
    ], {
      ...laneView,
      cardOrder: { [kanbanOrderKey('Ada', 'doing')]: ['B.md'] },
    }, root);

    expect(titles(kanbanCell(board, 'Ada', 'doing'))).toEqual(['/vault/B.md', '/vault/A.md']);
    expect(titles(kanbanCell(board, 'Bob', 'doing'))).toEqual(['/vault/C.md']);
  });

  it('moves a card between lanes and rewrites both cell orders', () => {
    const board = buildKanbanBoard(laneRows, laneView, root);
    const order = kanbanOrderWithCard(
      kanbanCells(board), laneRows[0], kanbanCell(board, 'Bob', 'doing')!, 1, root,
    );

    expect(order[kanbanOrderKey('Ada', 'doing')]).toBeUndefined();
    expect(order[kanbanOrderKey('Ada', 'todo')]).toEqual(['B.md']);
    expect(order[kanbanOrderKey('Bob', 'doing')]).toEqual(['C.md', 'A.md']);
    expect(order[kanbanOrderKey('', 'todo')]).toEqual(['D.md']);
  });

  it('falls back to a plain column key when a lane has no own entry', () => {
    const board = buildKanbanBoard(laneRows, {
      ...laneView,
      cardOrder: { doing: ['C.md'] },
      wipLimits: { todo: 1 },
    }, root);

    expect(titles(kanbanCell(board, 'Bob', 'doing'))).toEqual(['/vault/C.md']);
    expect(titles(kanbanCell(board, 'Ada', 'doing'))).toEqual(['/vault/A.md']);
    expect(kanbanCell(board, 'Ada', 'todo')!.limit).toBe(1);
    expect(kanbanCell(board, 'Bob', 'todo')!.limit).toBe(1);
    expect(kanbanCell(board, 'Bob', 'doing')!.limit).toBeUndefined();
  });

  it('keeps a single unassigned lane when the lane property has no values', () => {
    const board = buildKanbanBoard(rows, { ...view, laneBy: { property: 'owner' } }, root);
    expect(board.laneValues).toEqual(['']);
    expect(board.lanes[0].key).toBe('__empty__');
    expect(titles(kanbanCell(board, '', 'doing'))).toEqual(['/vault/A.md', '/vault/C.md']);
  });
});
