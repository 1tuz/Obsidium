import type {
  BaseDefinition,
  BaseFilter,
  BaseGroupBy,
  BaseScalar,
  BaseSort,
  BaseViewDefinition,
} from './types';

type YamlValue = BaseScalar | YamlValue[] | { [key: string]: YamlValue };

type ParsedLine = {
  indent: number;
  text: string;
};

const SUPPORTED_TOP_LEVEL = new Set(['filters', 'views', 'properties', 'formulas', 'summaries']);

function indentation(line: string): number {
  let count = 0;
  for (const char of line) {
    if (char === ' ') count += 1;
    else if (char === '\t') count += 2;
    else break;
  }
  return count;
}

function linesOf(raw: string): ParsedLine[] {
  return raw.replace(/\r\n/g, '\n').split('\n').flatMap((line) => {
    const text = line.trim();
    if (!text || text.startsWith('#')) return [];
    return [{ indent: indentation(line), text }];
  });
}

function splitKeyValue(text: string): [string, string] | null {
  let quote = '';
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote && text[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '[' || char === '{' || char === '(') depth += 1;
    if (char === ']' || char === '}' || char === ')') depth = Math.max(0, depth - 1);
    if (char === ':' && depth === 0) {
      return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
    }
  }
  return null;
}

function inlineParts(value: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote = '';
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      current += char;
      if (char === quote && value[index - 1] !== '\\') quote = '';
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    if (char === '[' || char === '{' || char === '(') depth += 1;
    if (char === ']' || char === '}' || char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0 && !quote) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function scalar(value: string): YamlValue {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return inlineParts(trimmed.slice(1, -1)).map(scalar);
  }
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed === 'null' || trimmed === '~') return null;
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true';
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseMap(lines: ParsedLine[], start: number, indent: number): [YamlValue, number] {
  const value: Record<string, YamlValue> = {};
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      index += 1;
      continue;
    }
    if (line.text.startsWith('- ')) break;
    const pair = splitKeyValue(line.text);
    if (!pair) {
      index += 1;
      continue;
    }
    const [key, rest] = pair;
    if (rest) {
      value[key] = scalar(rest);
      index += 1;
      continue;
    }
    const next = lines[index + 1];
    if (!next || next.indent <= indent) {
      value[key] = null;
      index += 1;
      continue;
    }
    const [child, after] = parseBlock(lines, index + 1, next.indent);
    value[key] = child;
    index = after;
  }
  return [value, index];
}

function parseSequence(lines: ParsedLine[], start: number, indent: number): [YamlValue, number] {
  const value: YamlValue[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) break;
    if (line.indent !== indent || !line.text.startsWith('-')) break;
    const rest = line.text.slice(1).trim();
    if (!rest) {
      const next = lines[index + 1];
      if (!next || next.indent <= indent) {
        value.push(null);
        index += 1;
      } else {
        const [child, after] = parseBlock(lines, index + 1, next.indent);
        value.push(child);
        index = after;
      }
      continue;
    }

    const pair = splitKeyValue(rest);
    if (!pair) {
      value.push(scalar(rest));
      index += 1;
      continue;
    }

    const item: Record<string, YamlValue> = {};
    const [key, tail] = pair;
    item[key] = tail ? scalar(tail) : null;
    index += 1;

    if (!tail) {
      const next = lines[index];
      if (next && next.indent > indent) {
        const [child, after] = parseBlock(lines, index, next.indent);
        item[key] = child;
        index = after;
      }
    }

    const continuation = lines[index];
    if (continuation && continuation.indent > indent && !continuation.text.startsWith('- ')) {
      const [extra, after] = parseMap(lines, index, continuation.indent);
      if (isObject(extra)) Object.assign(item, extra);
      index = after;
    }
    value.push(item);
  }
  return [value, index];
}

function parseBlock(lines: ParsedLine[], start: number, indent: number): [YamlValue, number] {
  return lines[start]?.text.startsWith('-')
    ? parseSequence(lines, start, indent)
    : parseMap(lines, start, indent);
}

function isObject(value: YamlValue | undefined): value is Record<string, YamlValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: YamlValue | undefined, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : fallback;
}

function filter(value: YamlValue | undefined): BaseFilter | undefined {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return undefined;
  const result: Exclude<BaseFilter, string> = {};
  if (Array.isArray(value.and)) result.and = value.and.map(filter).filter(Boolean) as BaseFilter[];
  if (Array.isArray(value.or)) result.or = value.or.map(filter).filter(Boolean) as BaseFilter[];
  if (value.not !== undefined) {
    if (Array.isArray(value.not)) {
      result.not = value.not.map(filter).filter(Boolean) as BaseFilter[];
    } else {
      result.not = filter(value.not);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function groupBy(value: YamlValue | undefined): BaseGroupBy | undefined {
  if (!isObject(value)) return undefined;
  const property = text(value.property);
  if (!property) return undefined;
  const direction = text(value.direction).toUpperCase();
  return {
    property,
    direction: direction === 'DESC' ? 'DESC' : 'ASC',
  };
}

function sort(value: YamlValue | undefined): BaseSort[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.flatMap((entry) => {
    if (!isObject(entry)) return [];
    const property = text(entry.property);
    if (!property) return [];
    return [{
      property,
      direction: text(entry.direction).toUpperCase() === 'DESC' ? 'DESC' as const : 'ASC' as const,
    }];
  });
  return items.length > 0 ? items : undefined;
}

function view(value: YamlValue, index: number): BaseViewDefinition | null {
  if (!isObject(value)) return null;
  const type = text(value.type, 'table').toLowerCase();
  const order = Array.isArray(value.order) ? value.order.map((entry) => text(entry)).filter(Boolean) : [];
  const groupOrder = Array.isArray(value.groupOrder)
    ? value.groupOrder.filter((entry): entry is BaseScalar => (
      entry === null || ['string', 'number', 'boolean'].includes(typeof entry)
    ))
    : undefined;
  const limit = typeof value.limit === 'number' && Number.isFinite(value.limit)
    ? Math.max(1, Math.floor(value.limit))
    : undefined;
  return {
    type,
    name: text(value.name, `${type || 'view'} ${index + 1}`),
    order,
    filters: filter(value.filters),
    groupBy: groupBy(value.groupBy),
    groupOrder,
    sort: sort(value.sort),
    limit,
  };
}

export function parseBase(raw: string): BaseDefinition {
  const lines = linesOf(raw);
  const [document] = lines.length > 0 ? parseBlock(lines, 0, lines[0].indent) : [{}, 0];
  const root = isObject(document) ? document : {};
  const properties = isObject(root.properties) ? root.properties : {};
  const propertyLabels: Record<string, string> = {};
  for (const [key, definition] of Object.entries(properties)) {
    if (!isObject(definition)) continue;
    const label = text(definition.displayName);
    if (label) propertyLabels[key] = label;
  }
  const views = Array.isArray(root.views)
    ? root.views.map(view).filter((item): item is BaseViewDefinition => item !== null)
    : [];
  return {
    raw,
    filters: filter(root.filters),
    views: views.length > 0 ? views : [{ type: 'table', name: 'Table', order: ['file.name'] }],
    propertyLabels,
    unsupportedKeys: Object.keys(root).filter((key) => !SUPPORTED_TOP_LEVEL.has(key)),
  };
}

export function serializeBase(definition: BaseDefinition): string {
  return definition.raw;
}
