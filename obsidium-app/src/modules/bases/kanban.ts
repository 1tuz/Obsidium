import { relativePath } from '../paths';
import { baseProperty } from './properties';
import type { BaseFieldValue, BaseRow, BaseViewDefinition } from './types';

export interface KanbanCell {
  key: string;
  laneValue: string;
  columnValue: string;
  rows: BaseRow[];
  limit?: number;
  overLimit: boolean;
}

export interface KanbanLane {
  key: string;
  value: string;
  cells: KanbanCell[];
}

export interface KanbanBoardLayout {
  laneProperty: string | null;
  laneValues: string[];
  columnValues: string[];
  lanes: KanbanLane[];
}

const ORDER_SEPARATOR = ' / ';

function display(value: BaseFieldValue | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === null || value === undefined ? '' : String(value);
}

export function kanbanProperty(view: BaseViewDefinition): string {
  return view.groupBy?.property || 'status';
}

export function kanbanLaneProperty(view: BaseViewDefinition): string | null {
  return view.laneBy?.property || null;
}

export function kanbanWritableProperty(property: string): boolean {
  return !property.startsWith('file.') && !property.startsWith('formula.');
}

export function kanbanRowKey(row: BaseRow, workspacePath: string): string {
  try {
    return relativePath(workspacePath, row.path);
  } catch {
    return row.path;
  }
}

export function kanbanOrderKey(lane: string, column: string): string {
  return lane ? `${lane}${ORDER_SEPARATOR}${column}` : column;
}

function orderedRows(
  rows: BaseRow[],
  stored: readonly string[] | undefined,
  workspacePath: string,
): BaseRow[] {
  if (!stored || stored.length === 0) return rows;
  const ranks = new Map<string, number>();
  stored.forEach((entry, index) => {
    if (!ranks.has(entry)) ranks.set(entry, index);
  });
  const rank = (row: BaseRow): number => {
    const key = kanbanRowKey(row, workspacePath);
    return ranks.get(key) ?? ranks.get(row.path) ?? Number.MAX_SAFE_INTEGER;
  };
  return rows
    .map((row, index) => ({ row, index, rank: rank(row) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.row);
}

function orderedValues(
  observed: Iterable<string>,
  configured: readonly string[],
  direction: 'ASC' | 'DESC' | undefined,
): string[] {
  const configuredSet = new Set(configured);
  const extra = [...observed]
    .filter((value) => !configuredSet.has(value))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (direction === 'DESC') extra.reverse();
  return [...configured, ...extra];
}

export function buildKanbanBoard(
  rows: readonly BaseRow[],
  view: BaseViewDefinition,
  workspacePath: string,
): KanbanBoardLayout {
  const columnProperty = kanbanProperty(view);
  const laneProperty = kanbanLaneProperty(view);
  const observedColumns = new Set<string>();
  const observedLanes = new Set<string>();
  const buckets = new Map<string, BaseRow[]>();

  for (const row of rows) {
    const columnValue = display(baseProperty(row, columnProperty, workspacePath));
    const laneValue = laneProperty === null
      ? ''
      : display(baseProperty(row, laneProperty, workspacePath));
    observedColumns.add(columnValue);
    observedLanes.add(laneValue);
    const key = kanbanOrderKey(laneValue, columnValue);
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  const columnValues = orderedValues(
    observedColumns,
    (view.groupOrder ?? []).map((value) => String(value ?? '')),
    view.groupBy?.direction,
  );
  if (columnValues.length === 0) columnValues.push('');

  const laneValues = laneProperty === null
    ? ['']
    : orderedValues(
      observedLanes,
      (view.laneOrder ?? []).map((value) => String(value ?? '')),
      view.laneBy?.direction,
    );
  if (laneValues.length === 0) laneValues.push('');

  const lanes = laneValues.map((laneValue) => ({
    key: laneValue || '__empty__',
    value: laneValue,
    cells: columnValues.map((columnValue) => {
      const key = kanbanOrderKey(laneValue, columnValue);
      const cellRows = orderedRows(
        buckets.get(key) ?? [],
        view.cardOrder?.[key] ?? (laneValue ? view.cardOrder?.[columnValue] : undefined),
        workspacePath,
      );
      const limit = view.wipLimits?.[key]
        ?? (laneValue ? view.wipLimits?.[columnValue] : undefined);
      return {
        key,
        laneValue,
        columnValue,
        rows: cellRows,
        limit,
        overLimit: limit !== undefined && cellRows.length > limit,
      };
    }),
  }));

  return { laneProperty, laneValues, columnValues, lanes };
}

export function kanbanCells(board: KanbanBoardLayout): KanbanCell[] {
  return board.lanes.flatMap((lane) => lane.cells);
}

export function kanbanCell(
  board: KanbanBoardLayout,
  laneValue: string,
  columnValue: string,
): KanbanCell | undefined {
  return board.lanes
    .find((lane) => lane.value === laneValue)
    ?.cells.find((cell) => cell.columnValue === columnValue);
}

export function kanbanOrderWithCard(
  cells: readonly KanbanCell[],
  row: BaseRow,
  target: KanbanCell,
  index: number,
  workspacePath: string,
): Record<string, string[]> {
  const order: Record<string, string[]> = {};
  for (const cell of cells) {
    const paths = cell.rows
      .filter((entry) => entry.path !== row.path)
      .map((entry) => kanbanRowKey(entry, workspacePath));
    if (paths.length > 0) order[cell.key] = paths;
  }
  const ordered = [...(order[target.key] ?? [])];
  const currentIndex = target.rows.findIndex((entry) => entry.path === row.path);
  const insertion = currentIndex !== -1 && currentIndex < index ? index - 1 : index;
  ordered.splice(
    Math.max(0, Math.min(insertion, ordered.length)),
    0,
    kanbanRowKey(row, workspacePath),
  );
  order[target.key] = ordered;
  return order;
}
