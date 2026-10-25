import type {
  BaseDefinition,
  BaseFilter,
  BaseGroupBy,
  BaseScalar,
  BaseSort,
  BaseSummary,
  BaseViewDefinition,
  BaseYamlValue,
} from './types';

type YamlValue = BaseYamlValue;

type ParsedLine = {
  indent: number;
  text: string;
};

const SUPPORTED_TOP_LEVEL: Record<string, true> = {
  filters: true,
  views: true,
  properties: true,
  formulas: true,
  summaries: true,
};
const VIEW_KEYS: Record<string, true> = {
  type: true,
  name: true,
  limit: true,
  dateField: true,
  startField: true,
  endField: true,
  order: true,
  filters: true,
  groupBy: true,
  laneBy: true,
  sort: true,
  groupOrder: true,
  laneOrder: true,
  cardOrder: true,
  wipLimits: true,
};
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const PLAIN_START = '-?:,[]{}#&*!|>\'"%@`';

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

function decodeKey(key: string): string {
  const trimmed = key.trim();
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
  return trimmed;
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
  if (trimmed === '{}') return {};
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
  if (NUMBER.test(trimmed)) return Number(trimmed);
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
    const decoded = decodeKey(key);
    if (rest) {
      value[decoded] = scalar(rest);
      index += 1;
      continue;
    }
    const next = lines[index + 1];
    if (!next || next.indent <= indent) {
      value[decoded] = null;
      index += 1;
      continue;
    }
    const [child, after] = parseBlock(lines, index + 1, next.indent);
    value[decoded] = child;
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
    const decoded = decodeKey(key);
    item[decoded] = tail ? scalar(tail) : null;
    index += 1;

    if (!tail) {
      const next = lines[index];
      if (next && next.indent > indent) {
        const [child, after] = parseBlock(lines, index, next.indent);
        item[decoded] = child;
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
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (!isObject(value)) return { unsupported: true, raw: value };
  const operators = Object.keys(value);
  if (operators.length !== 1) return { unsupported: true, raw: value };
  const operator = operators[0];
  if (operator === 'and' || operator === 'or') {
    const operands = value[operator];
    if (!Array.isArray(operands)) return { unsupported: true, raw: value };
    const filters = operands.map((operand) => filter(operand) ?? { unsupported: true as const });
    return operator === 'and' ? { and: filters } : { or: filters };
  }
  if (operator === 'not') {
    const operand = value.not;
    return Array.isArray(operand)
      ? { not: operand.map((item) => filter(item) ?? { unsupported: true }) }
      : { not: filter(operand) ?? { unsupported: true } };
  }
  return { unsupported: true, raw: value };
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

function cardOrder(value: YamlValue | undefined): Record<string, string[]> | undefined {
  if (!isObject(value)) return undefined;
  const result: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!Array.isArray(entry)) continue;
    const paths = entry.flatMap((item) => {
      const path = text(item);
      return path ? [path] : [];
    });
    if (paths.length > 0) result[key] = paths;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function wipLimits(value: YamlValue | undefined): Record<string, number> | undefined {
  if (!isObject(value)) return undefined;
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) continue;
    result[key] = Math.max(1, Math.floor(entry));
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function summary(value: YamlValue): BaseSummary | null {
  if (!isObject(value)) return null;
  const name = text(value.name);
  const source = text(value.source);
  if (!name || !source) return null;
  return {
    name,
    source,
    property: text(value.property),
    formula: text(value.formula).toLowerCase(),
    filter: filter(value.filter),
  };
}

function scalarList(value: YamlValue | undefined): BaseScalar[] | undefined {
  return Array.isArray(value)
    ? value.filter((entry): entry is BaseScalar => (
      entry === null || ['string', 'number', 'boolean'].includes(typeof entry)
    ))
    : undefined;
}

function view(value: YamlValue, index: number): BaseViewDefinition | null {
  if (!isObject(value)) return null;
  const type = text(value.type, 'table').toLowerCase();
  const order = Array.isArray(value.order) ? value.order.map((entry) => text(entry)).filter(Boolean) : [];
  const groupOrder = scalarList(value.groupOrder);
  const laneOrder = scalarList(value.laneOrder);
  const limit = typeof value.limit === 'number' && Number.isFinite(value.limit)
    ? Math.max(1, Math.floor(value.limit))
    : undefined;
  const dateField = text(value.dateField) || undefined;
  const startField = text(value.startField) || undefined;
  const endField = text(value.endField) || undefined;
  const definition: BaseViewDefinition = {
    type,
    name: text(value.name, `${type || 'view'} ${index + 1}`),
    order,
    limit,
    dateField,
    startField,
    endField,
    filters: filter(value.filters),
    groupBy: groupBy(value.groupBy),
    laneBy: groupBy(value.laneBy),
    groupOrder,
    laneOrder,
    sort: sort(value.sort),
  };
  const extra: Record<string, BaseYamlValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (VIEW_KEYS[key] === true) continue;
    extra[key] = entry;
  }
  if (Object.keys(extra).length > 0) definition.extra = extra;
  const storedOrder = cardOrder(value.cardOrder);
  if (storedOrder) definition.cardOrder = storedOrder;
  const limits = wipLimits(value.wipLimits);
  if (limits) definition.wipLimits = limits;
  return definition;
}

export function parseBase(raw: string): BaseDefinition {
  const lines = linesOf(raw);
  const [document] = lines.length > 0 ? parseBlock(lines, 0, lines[0].indent) : [{}, 0];
  const root = isObject(document) ? document : {};
  const properties = isObject(root.properties) ? root.properties : {};
  const propertyLabels: Record<string, string> = {};
  const relationProperties: string[] = [];
  for (const [key, definition] of Object.entries(properties)) {
    if (!isObject(definition)) continue;
    const label = text(definition.displayName);
    if (label) propertyLabels[key] = label;
    if (text(definition.type).trim().toLowerCase() === 'relation') relationProperties.push(key);
  }
  const views = Array.isArray(root.views)
    ? root.views.map(view).filter((item): item is BaseViewDefinition => item !== null)
    : [];
  const extra: Record<string, BaseYamlValue> = {};
  for (const [key, entry] of Object.entries(root)) {
    if (key === 'filters' || key === 'views') continue;
    extra[key] = entry;
  }
  const formulas: Record<string, string> = {};
  if (isObject(root.formulas)) {
    for (const [key, expression] of Object.entries(root.formulas)) {
      const source = text(expression).trim();
      if (source) formulas[key] = source;
    }
  }
  const summaries = Array.isArray(root.summaries)
    ? root.summaries.flatMap((entry) => {
      const item = summary(entry);
      return item ? [item] : [];
    })
    : [];
  return {
    raw,
    filters: filter(root.filters),
    views: views.length > 0 ? views : [{ type: 'table', name: 'Table', order: ['file.name'] }],
    summaries,
    propertyLabels,
    relationProperties,
    formulas,
    unsupportedKeys: Object.keys(root)
      .filter((key) => SUPPORTED_TOP_LEVEL[key] !== true)
      .sort(),
    extra,
  };
}

function isYamlObject(value: BaseYamlValue | undefined): value is Record<string, BaseYamlValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function setRelationProperties(
  definition: BaseDefinition,
  keys: readonly string[],
): void {
  const wanted = new Set(keys);
  const properties: Record<string, BaseYamlValue> = isYamlObject(definition.extra.properties)
    ? { ...definition.extra.properties }
    : {};
  const known = new Set([...Object.keys(properties), ...definition.relationProperties]);
  for (const key of known) {
    const entry = properties[key];
    if (wanted.has(key)) {
      properties[key] = isYamlObject(entry) ? { ...entry, type: 'relation' } : { type: 'relation' };
      continue;
    }
    if (!isYamlObject(entry) || text(entry.type).toLowerCase() !== 'relation') continue;
    const remaining: Record<string, BaseYamlValue> = {};
    for (const [name, value] of Object.entries(entry)) {
      if (name !== 'type') remaining[name] = value;
    }
    if (Object.keys(remaining).length > 0) properties[key] = remaining;
    else delete properties[key];
  }
  if (Object.keys(properties).length > 0) definition.extra.properties = properties;
  else delete definition.extra.properties;
  definition.relationProperties = [...wanted].sort();
}

function plainText(value: string): string {
  if (!value) return JSON.stringify(value);
  if (value !== value.trim()) return JSON.stringify(value);
  if (/[\u0000-\u001f\u007f]/.test(value)) return JSON.stringify(value);
  if (/["']/.test(value)) return JSON.stringify(value);
  if (PLAIN_START.includes(value[0])) return JSON.stringify(value);
  if (/[,{}\[\]#]/.test(value)) return JSON.stringify(value);
  if (value.includes(': ') || value.endsWith(':')) return JSON.stringify(value);
  if (/^(?:true|false|null|~)$/i.test(value)) return JSON.stringify(value);
  if (NUMBER.test(value)) return JSON.stringify(value);
  return value;
}

function keyText(key: string): string {
  if (!key) return JSON.stringify(key);
  if (key !== key.trim()) return JSON.stringify(key);
  if (/[\u0000-\u001f\u007f]/.test(key)) return JSON.stringify(key);
  if (PLAIN_START.includes(key[0])) return JSON.stringify(key);
  if (key.includes(':') || key.includes('#') || /["'\\]/.test(key)) return JSON.stringify(key);
  return key;
}

function scalarText(value: BaseScalar): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : JSON.stringify(String(value));
  return plainText(value);
}

function isScalar(value: BaseYamlValue): value is BaseScalar {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function inlineValue(value: BaseYamlValue): string | null {
  if (isScalar(value)) return scalarText(value);
  if (Array.isArray(value)) {
    if (value.every(isScalar)) return `[${value.map(scalarText).join(', ')}]`;
    return null;
  }
  return Object.keys(value).length === 0 ? '{}' : null;
}

function renderMap(value: Record<string, BaseYamlValue>, indent: number): string[] {
  const lines: string[] = [];
  for (const [key, entry] of Object.entries(value)) {
    const inline = inlineValue(entry);
    if (inline !== null) {
      lines.push(`${' '.repeat(indent)}${keyText(key)}: ${inline}`);
      continue;
    }
    lines.push(`${' '.repeat(indent)}${keyText(key)}:`);
    lines.push(...renderBlock(entry, indent + 2));
  }
  return lines;
}

function renderSequence(value: BaseYamlValue[], indent: number): string[] {
  const lines: string[] = [];
  for (const item of value) {
    const inline = inlineValue(item);
    if (inline !== null) {
      lines.push(`${' '.repeat(indent)}- ${inline}`);
      continue;
    }
    if (isYamlObject(item)) {
      const entries = Object.entries(item);
      const [firstKey, firstValue] = entries[0];
      const firstInline = inlineValue(firstValue);
      if (firstInline !== null) {
        lines.push(`${' '.repeat(indent)}- ${keyText(firstKey)}: ${firstInline}`);
      } else if (Array.isArray(firstValue) || isYamlObject(firstValue)) {
        lines.push(`${' '.repeat(indent)}- ${keyText(firstKey)}:`);
        lines.push(...renderBlock(firstValue, indent + 4));
      }
      const rest: Record<string, BaseYamlValue> = {};
      for (const [key, entry] of entries.slice(1)) rest[key] = entry;
      if (Object.keys(rest).length > 0) lines.push(...renderMap(rest, indent + 2));
      continue;
    }
    lines.push(`${' '.repeat(indent)}-`);
    lines.push(...renderBlock(item, indent + 2));
  }
  return lines;
}

function renderBlock(value: BaseYamlValue, indent: number): string[] {
  const inline = inlineValue(value);
  if (inline !== null) return [`${' '.repeat(indent)}${inline}`];
  if (Array.isArray(value)) return renderSequence(value, indent);
  if (isYamlObject(value)) return renderMap(value, indent);
  return [`${' '.repeat(indent)}${scalarText(value)}`];
}

function filterValue(value: BaseFilter): BaseYamlValue {
  if (typeof value === 'string') return value;
  if (value.unsupported) return value.raw === undefined ? null : value.raw;
  if (value.and) return { and: value.and.map(filterValue) };
  if (value.or) return { or: value.or.map(filterValue) };
  if (value.not !== undefined) {
    return {
      not: Array.isArray(value.not) ? value.not.map(filterValue) : filterValue(value.not),
    };
  }
  return null;
}

function propertiesValue(definition: BaseDefinition): BaseYamlValue | undefined {
  const raw = definition.extra.properties;
  const labels = definition.propertyLabels;
  const labelKeys = Object.keys(labels);
  if (isYamlObject(raw)) {
    const keys = new Set([...Object.keys(raw), ...labelKeys]);
    const merged: Record<string, BaseYamlValue> = {};
    for (const key of [...keys].sort()) {
      const entry = raw[key];
      const label = labels[key];
      if (isYamlObject(entry)) {
        merged[key] = label ? { ...entry, displayName: label } : { ...entry };
      } else {
        merged[key] = label ? { displayName: label } : entry;
      }
    }
    return merged;
  }
  if (raw !== undefined) {
    if (labelKeys.length === 0) return raw;
    const merged: Record<string, BaseYamlValue> = {};
    for (const key of labelKeys.sort()) merged[key] = { displayName: labels[key] };
    return merged;
  }
  if (labelKeys.length === 0) return undefined;
  const merged: Record<string, BaseYamlValue> = {};
  for (const key of labelKeys.sort()) merged[key] = { displayName: labels[key] };
  return merged;
}

function viewValue(view: BaseViewDefinition): BaseYamlValue {
  const result: Record<string, BaseYamlValue> = {};
  result.type = view.type;
  result.name = view.name;
  if (view.dateField) result.dateField = view.dateField;
  if (view.startField) result.startField = view.startField;
  if (view.endField) result.endField = view.endField;
  if (view.limit !== undefined) result.limit = view.limit;
  if (view.order.length > 0) result.order = [...view.order];
  if (view.filters !== undefined) result.filters = filterValue(view.filters);
  if (view.groupBy) {
    result.groupBy = {
      property: view.groupBy.property,
      direction: view.groupBy.direction ?? 'ASC',
    };
  }
  if (view.laneBy) {
    result.laneBy = {
      property: view.laneBy.property,
      direction: view.laneBy.direction ?? 'ASC',
    };
  }
  if (view.sort !== undefined) {
    result.sort = view.sort.map((entry) => ({
      property: entry.property,
      direction: entry.direction ?? 'ASC',
    }));
  }
  if (view.groupOrder !== undefined) result.groupOrder = [...view.groupOrder];
  if (view.laneOrder !== undefined) result.laneOrder = [...view.laneOrder];
  if (view.cardOrder !== undefined) {
    const order: Record<string, BaseYamlValue> = {};
    for (const key of Object.keys(view.cardOrder).sort()) {
      order[key] = [...view.cardOrder[key]];
    }
    if (Object.keys(order).length > 0) result.cardOrder = order;
  }
  if (view.wipLimits !== undefined) {
    const limits: Record<string, BaseYamlValue> = {};
    for (const key of Object.keys(view.wipLimits).sort()) {
      limits[key] = view.wipLimits[key];
    }
    if (Object.keys(limits).length > 0) result.wipLimits = limits;
  }
  const extra = view.extra ?? {};
  for (const key of Object.keys(extra).sort()) {
    if (VIEW_KEYS[key] === true) continue;
    result[key] = extra[key];
  }
  return result;
}

export function serializeBase(definition: BaseDefinition): string {
  const root: Record<string, BaseYamlValue> = {};
  if (definition.filters !== undefined) root.filters = filterValue(definition.filters);
  const properties = propertiesValue(definition);
  if (properties !== undefined) root.properties = properties;
  if (Object.keys(definition.formulas).length > 0) root.formulas = definition.formulas;
  if ('summaries' in definition.extra) root.summaries = definition.extra.summaries;
  root.views = definition.views.map(viewValue);
  for (const key of Object.keys(definition.extra).sort()) {
    if (SUPPORTED_TOP_LEVEL[key] === true) continue;
    root[key] = definition.extra[key];
  }
  return `${renderMap(root, 0).join('\n')}\n`;
}

export function renameFirstKanbanView(raw: string, name: string): string {
  const lines = raw.split(/\r\n|\n/u);
  const separator = raw.includes('\r\n') ? '\r\n' : '\n';
  const viewsIndex = lines.findIndex((line) => /^views\s*:/u.test(line));
  if (viewsIndex < 0) return raw;
  const sequenceIndent = lines.slice(viewsIndex + 1).map((line) => {
    const match = /^(\s*)-/u.exec(line);
    return match ? match[1].length : null;
  }).find((indent) => indent !== null);
  if (sequenceIndent === undefined || sequenceIndent === null) return raw;

  let inKanban = false;
  let fieldIndent: number | null = null;
  let typeLineIndex: number | null = null;
  for (let index = viewsIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const indent = indentation(line);
    if (line.trim() && indent <= 0) break;
    if (indent === sequenceIndent && line.trimStart().startsWith('-')) {
      if (inKanban && typeLineIndex !== null) {
        lines.splice(typeLineIndex + 1, 0, `${' '.repeat(fieldIndent ?? sequenceIndent + 2)}name: ${JSON.stringify(name)}`);
        return lines.join(separator);
      }
      inKanban = /^-\s*type\s*:\s*kanban(?:\s|$)/u.test(line.trimStart())
        || /^-\s*$/u.test(line.trimStart());
      fieldIndent = inKanban && line.includes('type:') ? indent + 2 : null;
      typeLineIndex = inKanban && line.includes('type:') ? index : null;
      continue;
    }
    if (!inKanban) continue;
    const typeMatch = /^(\s*)type\s*:\s*kanban\s*$/u.exec(line);
    if (typeMatch) {
      fieldIndent = typeMatch[1].length;
      typeLineIndex = index;
    }
    const nameMatch = /^(\s*name\s*:\s*).*$/u.exec(line);
    if (nameMatch && indentation(line) === fieldIndent) {
      let quote = '';
      let commentIndex = -1;
      for (let character = 0; character < line.length - 1; character += 1) {
        const current = line[character];
        if (quote) {
          if (quote === "'" && current === "'" && line[character + 1] === "'") {
            character += 1;
          } else if (current === quote && line[character - 1] !== '\\') {
            quote = '';
          }
        } else if (current === '"' || current === "'") {
          quote = current;
        } else if (current === ' ' && line[character + 1] === '#') {
          commentIndex = character;
          break;
        }
      }
      const comment = commentIndex < 0 ? '' : line.slice(commentIndex);
      lines[index] = `${nameMatch[1]}${JSON.stringify(name)}${comment}`;
      return lines.join(separator);
    }
  }
  if (inKanban && typeLineIndex !== null) {
    lines.splice(typeLineIndex + 1, 0, `${' '.repeat(fieldIndent ?? sequenceIndent + 2)}name: ${JSON.stringify(name)}`);
    return lines.join(separator);
  }
  return raw;
}
