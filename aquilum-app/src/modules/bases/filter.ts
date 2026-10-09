import { fileName, parentDirectory, relativePath } from '../paths';
import type { BaseFieldValue, BaseFilter, BaseRow, BaseSort } from './types';

export interface FilterResult {
  match: boolean;
  unsupported: boolean;
}

function valueText(value: BaseFieldValue | undefined): string {
  if (Array.isArray(value)) return value.join(', ');
  return value === null || value === undefined ? '' : String(value);
}

function extension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : '';
}

export function baseProperty(
  row: BaseRow,
  property: string,
  workspacePath: string,
): BaseFieldValue | undefined {
  const relative = relativePath(workspacePath, row.path);
  switch (property) {
    case 'file.name': return fileName(row.path).replace(/\.[^.]+$/, '');
    case 'file.path': return relative;
    case 'file.ext': return extension(row.path);
    case 'file.folder': return parentDirectory(relative).replace(/\\/g, '/');
    default: {
      const key = property.startsWith('note.') ? property.slice('note.'.length) : property;
      return row.fields[key];
    }
  }
}

function literal(raw: string): BaseFieldValue {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)) return Number(value);
  if (value === 'null') return null;
  return value;
}

function scalarCompare(left: BaseFieldValue | undefined, right: BaseFieldValue, operator: string): boolean {
  if (Array.isArray(left)) {
    if (operator === '!=') return left.every((item) => !scalarCompare(item, right, '=='));
    if (operator === '==') return left.some((item) => scalarCompare(item, right, '=='));
    left = left.join(', ');
  }
  if (typeof right === 'number') {
    const number = Number(left);
    if (!Number.isFinite(number)) return false;
    if (operator === '>') return number > right;
    if (operator === '>=') return number >= right;
    if (operator === '<') return number < right;
    if (operator === '<=') return number <= right;
    return operator === '==' ? number === right : number !== right;
  }
  const a = valueText(left).toLocaleLowerCase();
  const b = valueText(right).toLocaleLowerCase();
  if (operator === '>') return a > b;
  if (operator === '>=') return a >= b;
  if (operator === '<') return a < b;
  if (operator === '<=') return a <= b;
  return operator === '==' ? a === b : a !== b;
}

function tagsOf(row: BaseRow): string[] {
  const value = row.fields.tags;
  const tags = Array.isArray(value) ? value : valueText(value).split(',');
  return tags.map((tag) => tag.trim().replace(/^#/, '').toLocaleLowerCase()).filter(Boolean);
}

function evaluateExpression(
  expression: string,
  row: BaseRow,
  workspacePath: string,
): FilterResult {
  const hasTag = expression.match(/^file\.hasTag\((.+)\)$/i);
  if (hasTag) {
    const wanted = valueText(literal(hasTag[1])).replace(/^#/, '').toLocaleLowerCase();
    return { match: tagsOf(row).some((tag) => tag === wanted || tag.startsWith(`${wanted}/`)), unsupported: false };
  }
  const inFolder = expression.match(/^file\.inFolder\((.+)\)$/i);
  if (inFolder) {
    const wanted = valueText(literal(inFolder[1])).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLocaleLowerCase();
    const folder = valueText(baseProperty(row, 'file.folder', workspacePath)).toLocaleLowerCase();
    return { match: folder === wanted || folder.startsWith(`${wanted}/`), unsupported: false };
  }
  const contains = expression.match(/^([\w.-]+)\.contains\((.+)\)$/i);
  if (contains) {
    const haystack = baseProperty(row, contains[1], workspacePath);
    const needle = valueText(literal(contains[2])).toLocaleLowerCase();
    const match = Array.isArray(haystack)
      ? haystack.some((item) => String(item).toLocaleLowerCase().includes(needle))
      : valueText(haystack).toLocaleLowerCase().includes(needle);
    return { match, unsupported: false };
  }
  const comparison = expression.match(/^([\w.-]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (comparison) {
    if (comparison[1].startsWith('formula.')) return { match: true, unsupported: true };
    return {
      match: scalarCompare(baseProperty(row, comparison[1], workspacePath), literal(comparison[3]), comparison[2]),
      unsupported: false,
    };
  }
  return { match: true, unsupported: true };
}

export function evaluateBaseFilter(
  filter: BaseFilter | undefined,
  row: BaseRow,
  workspacePath: string,
): FilterResult {
  if (!filter) return { match: true, unsupported: false };
  if (typeof filter === 'string') return evaluateExpression(filter, row, workspacePath);
  if (filter.and) {
    const results = filter.and.map((item) => evaluateBaseFilter(item, row, workspacePath));
    return { match: results.every((item) => item.match), unsupported: results.some((item) => item.unsupported) };
  }
  if (filter.or) {
    const results = filter.or.map((item) => evaluateBaseFilter(item, row, workspacePath));
    return { match: results.some((item) => item.match), unsupported: results.some((item) => item.unsupported) };
  }
  if (filter.not) {
    const list = Array.isArray(filter.not) ? filter.not : [filter.not];
    const results = list.map((item) => evaluateBaseFilter(item, row, workspacePath));
    if (results.some((item) => item.unsupported)) return { match: true, unsupported: true };
    return { match: !results.every((item) => item.match), unsupported: false };
  }
  return { match: true, unsupported: true };
}

export function sortBaseRows(
  rows: readonly BaseRow[],
  sort: readonly BaseSort[],
  workspacePath: string,
): BaseRow[] {
  if (sort.length === 0) return [...rows];
  return [...rows].sort((left, right) => {
    for (const item of sort) {
      const a = baseProperty(left, item.property, workspacePath);
      const b = baseProperty(right, item.property, workspacePath);
      const aNumber = Number(Array.isArray(a) ? Number.NaN : a);
      const bNumber = Number(Array.isArray(b) ? Number.NaN : b);
      const compared = Number.isFinite(aNumber) && Number.isFinite(bNumber)
        ? aNumber - bNumber
        : valueText(a).localeCompare(valueText(b), undefined, { numeric: true, sensitivity: 'base' });
      if (compared !== 0) return item.direction === 'DESC' ? -compared : compared;
    }
    return left.path.localeCompare(right.path);
  });
}
