import { parseFrontmatter, setFrontmatterField } from '../docs/frontmatter';
import { kanbanProperty } from './kanban';
import type { BaseDefinition, BaseFilter } from './types';

export type BoardMembership =
  | { kind: 'property'; property: string; value: string; groupBy: string; initialGroup: string }
  | { kind: 'tag'; tag: string; groupBy: string; initialGroup: string }
  | { kind: 'unsupported'; reason: string };

function filtersOf(filter: BaseFilter | undefined): BaseFilter[] | null {
  if (filter === undefined) return [];
  if (typeof filter === 'string') return [filter];
  if (filter.and?.length === 1 && Object.keys(filter).length === 1) return filtersOf(filter.and[0]);
  return null;
}

function quotedLiteral(value: string): string | null {
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return null;
    }
  }
  if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
  return null;
}

function unsupported(reason: string): BoardMembership {
  return { kind: 'unsupported', reason };
}

export function boardMembership(definition: BaseDefinition, viewIndex: number): BoardMembership {
  const view = definition.views[viewIndex];
  if (!view || view.type !== 'kanban') return unsupported('Selected view is not a Kanban view.');
  const global = filtersOf(definition.filters);
  const local = filtersOf(view.filters);
  if (!global || !local) {
    return unsupported('Membership uses a compound or ambiguous filter.');
  }
  if (global.length + local.length === 0) {
    return unsupported('This board includes the whole vault and has no membership property or tag.');
  }
  if (global.length + local.length !== 1) return unsupported('Membership uses a compound or ambiguous filter.');
  const filter = [...global, ...local][0];
  if (typeof filter !== 'string') return unsupported('Membership uses a compound or ambiguous filter.');
  const initialGroup = String(view.groupOrder?.[0] ?? 'todo');

  const tag = filter.match(/^file\.hasTag\((.+)\)$/i);
  if (tag) {
    const value = quotedLiteral(tag[1].trim())?.replace(/^#/, '');
    if (!value) return unsupported('Membership tag cannot be safely identified.');
    const groupBy = kanbanProperty(view).replace(/^note\./, '');
    if (groupBy === 'tags') return unsupported('Tags cannot be both board membership and the column property.');
    return { kind: 'tag', tag: value, groupBy, initialGroup };
  }
  if (/^file\.inFolder\(/i.test(filter)) {
    return unsupported('Membership is determined by the note’s folder, not its metadata.');
  }

  const property = filter.match(/^([\w.-]+)\s*==\s*("(?:\\.|[^"])*"|'(?:''|[^'])*')$/u);
  if (property) {
    const value = quotedLiteral(property[2]);
    const key = property[1].replace(/^note\./, '');
    if (!value || key === 'tags' || property[1].startsWith('file.') || property[1].startsWith('formula.')) {
      return unsupported('Membership is not a writable note property.');
    }
    const groupBy = kanbanProperty(view).replace(/^note\./, '');
    if (groupBy === 'tags') return unsupported('Tags cannot be both board membership and the column property.');
    if (key === groupBy && value !== initialGroup) {
      return unsupported('Membership value conflicts with the board’s first group.');
    }
    return { kind: 'property', property: key, value, groupBy, initialGroup };
  }
  return unsupported('Only one exact property equality or tag filter can be added automatically.');
}

function frontmatterValue(source: string, key: string): string | string[] | undefined {
  const value = parseFrontmatter(source)?.data[key];
  return value;
}

function currentValue(source: string, key: string): string | undefined {
  const value = frontmatterValue(source, key);
  return typeof value === 'string' ? value : undefined;
}

function setFields(source: string, fields: Record<string, string>): string {
  const parsed = parseFrontmatter(source);
  if (!parsed) {
    const lines = Object.entries(fields).map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    const separator = source.includes('\r\n') ? '\r\n' : '\n';
    return `---${separator}${lines.join(separator)}${separator}---${separator}${source}`;
  }
  return Object.entries(fields).reduce((content, [key, value]) => (
    setFrontmatterField(content, key, JSON.stringify(value)) ?? content
  ), source);
}

function tagValues(source: string): string[] | null {
  const value: unknown = parseFrontmatter(source)?.data.tags;
  if (value === undefined) return [];
  const tags = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : null;
  if (!tags) return null;
  return tags.map((tag) => {
    const trimmed = tag.trim();
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed) as string;
      } catch {
        return trimmed;
      }
    }
    return trimmed.startsWith("'") && trimmed.endsWith("'")
      ? trimmed.slice(1, -1).replace(/''/g, "'")
      : trimmed;
  }).filter(Boolean);
}

export function addToBoard(source: string, membership: BoardMembership, initialGroup: string): string {
  if (membership.kind === 'unsupported') return source;
  const fields: Record<string, string> = {};
  if (membership.kind === 'property') {
    if (Array.isArray(frontmatterValue(source, membership.property))
      || Array.isArray(frontmatterValue(source, membership.groupBy))) return source;
    const existing = currentValue(source, membership.property);
    if (existing !== undefined && existing !== '' && existing !== membership.value) return source;
    if (membership.groupBy === membership.property) {
      if (membership.value !== initialGroup) return source;
    } else {
      const group = currentValue(source, membership.groupBy);
      if (group !== undefined && group !== '' && group !== initialGroup) return source;
      if (group === undefined || group === '') fields[membership.groupBy] = initialGroup;
    }
    if (existing === undefined || existing === '') fields[membership.property] = membership.value;
    return Object.keys(fields).length > 0 ? setFields(source, fields) : source;
  }

  const tags = tagValues(source);
  if (!tags) return source;
  if (Array.isArray(frontmatterValue(source, membership.groupBy))) return source;
  const hasMembershipTag = tags.some((tag) => tag === membership.tag || tag.startsWith(`${membership.tag}/`));
  if (!hasMembershipTag) tags.push(membership.tag);
  const group = currentValue(source, membership.groupBy);
  if (group !== undefined && group !== '' && group !== initialGroup) return source;
  if (!hasMembershipTag) fields.tags = `[${tags.map((tag) => JSON.stringify(tag)).join(', ')}]`;
  if (group === undefined || group === '') fields[membership.groupBy] = initialGroup;
  if (!parseFrontmatter(source)) {
    const separator = source.includes('\r\n') ? '\r\n' : '\n';
    const lines = [`tags: ${fields.tags}`, ...(fields[membership.groupBy]
      ? [`${membership.groupBy}: ${JSON.stringify(fields[membership.groupBy])}`]
      : [])];
    return `---${separator}${lines.join(separator)}${separator}---${separator}${source}`;
  }
  let next = fields.tags ? setFrontmatterField(source, 'tags', fields.tags) ?? source : source;
  if (fields[membership.groupBy]) {
    next = setFrontmatterField(next, membership.groupBy, JSON.stringify(fields[membership.groupBy])) ?? next;
  }
  return next;
}

export function removeFromBoard(source: string, membership: BoardMembership): string {
  if (membership.kind === 'unsupported') return source;
  if (membership.kind === 'property') {
    if (currentValue(source, membership.property) !== membership.value) return source;
    return setFrontmatterField(source, membership.property, '') ?? source;
  }
  const tags = tagValues(source);
  if (!tags) return source;
  const nextTags = tags.filter((tag) => tag !== membership.tag && !tag.startsWith(`${membership.tag}/`));
  if (nextTags.length === tags.length) return source;
  return setFrontmatterField(source, 'tags', `[${nextTags.map((tag) => JSON.stringify(tag)).join(', ')}]`) ?? source;
}
