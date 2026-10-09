import { baseProperty } from './filter';
import type { BaseFieldValue, BaseRow, BaseViewDefinition } from './types';

export interface KanbanColumn {
  key: string;
  value: string;
  rows: BaseRow[];
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
  return values.map((value) => ({
    key: value || '__empty__',
    value,
    rows: buckets.get(value) ?? [],
  }));
}
