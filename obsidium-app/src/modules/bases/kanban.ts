import { relativePath } from '../paths';
import { baseProperty } from './properties';
import type { BaseFieldValue, BaseRow, BaseViewDefinition } from './types';

export interface KanbanColumn {
  key: string;
  value: string;
  rows: BaseRow[];
  limit?: number;
  overLimit: boolean;
}

function display(value: BaseFieldValue | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === null || value === undefined ? '' : String(value);
}

export function kanbanProperty(view: BaseViewDefinition): string {
  return view.groupBy?.property || 'status';
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

export function buildKanbanColumns(
  rows: readonly BaseRow[],
  view: BaseViewDefinition,
  workspacePath: string,
): KanbanColumn[] {
  const property = kanbanProperty(view);
  const buckets = new Map<string, BaseRow[]>();
  for (const row of rows) {
    const value = display(baseProperty(row, property, workspacePath));
    const bucket = buckets.get(value) ?? [];
    bucket.push(row);
    buckets.set(value, bucket);
  }

  const configured = (view.groupOrder ?? []).map((value) => String(value ?? ''));
  const configuredSet = new Set(configured);
  const observed = [...buckets.keys()]
    .filter((value) => !configuredSet.has(value))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  if (view.groupBy?.direction === 'DESC') observed.reverse();

  const values = [...configured, ...observed];
  if (values.length === 0) values.push('');
  return values.map((value) => {
    const columnRows = orderedRows(
      buckets.get(value) ?? [],
      view.cardOrder?.[value],
      workspacePath,
    );
    const limit = view.wipLimits?.[value];
    return {
      key: value || '__empty__',
      value,
      rows: columnRows,
      limit,
      overLimit: limit !== undefined && columnRows.length > limit,
    };
  });
}

export function kanbanOrderWithCard(
  columns: readonly KanbanColumn[],
  row: BaseRow,
  value: string,
  index: number,
  workspacePath: string,
): Record<string, string[]> {
  const order: Record<string, string[]> = {};
  for (const column of columns) {
    const paths = column.rows
      .filter((entry) => entry.path !== row.path)
      .map((entry) => kanbanRowKey(entry, workspacePath));
    if (paths.length > 0) order[column.value] = paths;
  }
  const target = [...(order[value] ?? [])];
  const source = columns.find((column) => column.value === value);
  const currentIndex = source
    ? source.rows.findIndex((entry) => entry.path === row.path)
    : -1;
  const insertion = currentIndex !== -1 && currentIndex < index ? index - 1 : index;
  target.splice(Math.max(0, Math.min(insertion, target.length)), 0, kanbanRowKey(row, workspacePath));
  order[value] = target;
  return order;
}
