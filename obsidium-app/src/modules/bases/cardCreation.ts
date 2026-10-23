import { absolutePath, parentDirectory } from '../paths';
import { boardMembership } from './boardMembership';
import { calendarProperty } from './calendar';
import { kanbanProperty, kanbanWritableProperty } from './kanban';
import type { BaseDefinition, BaseFieldValue, BaseFilter } from './types';

export interface KanbanCardDraft {
  directory: string;
  content: string;
  fields: Record<string, BaseFieldValue>;
}

function singleFilter(value: BaseFilter | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  if (Object.keys(value).length === 1 && value.and?.length === 1) {
    return singleFilter(value.and[0]);
  }
  throw new Error('Cannot create a card automatically for a compound board filter.');
}

function filterFolder(filter: string, workspacePath: string): string | null {
  const match = /^file\.inFolder\(("(?:\\.|[^"])*")\)$/i.exec(filter.trim());
  if (!match) return null;
  let relative: string;
  try {
    relative = JSON.parse(match[1]) as string;
  } catch {
    throw new Error('Invalid board folder filter.');
  }
  const parts = relative.replace(/\\/g, '/').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('Board folder must be a relative path inside the vault.');
  }
  return absolutePath(workspacePath, parts.join('/'));
}

function planCard(
  definition: BaseDefinition,
  viewIndex: number,
  basePath: string,
  workspacePath: string,
  title: string,
  ownField: { property: string; value: string } | null,
): KanbanCardDraft {
  const view = definition.views[viewIndex];
  if (!view) throw new Error('The selected view does not exist.');
  const normalizedTitle = title.trim();
  if (!normalizedTitle) throw new Error('Card title cannot be empty.');

  const global = singleFilter(definition.filters);
  const local = singleFilter(view.filters);
  if (global !== undefined && local !== undefined) {
    throw new Error('Cannot create a card automatically for multiple board filters.');
  }
  const filter = global ?? local;
  let directory = parentDirectory(basePath);
  const fields: Record<string, BaseFieldValue> = {};

  if (filter !== undefined) {
    const folder = filterFolder(filter, workspacePath);
    if (folder !== null) {
      directory = folder;
    } else {
      const membership = boardMembership(definition, viewIndex);
      if (membership.kind === 'unsupported') throw new Error(membership.reason);
      if (membership.kind === 'tag') {
        fields.tags = [membership.tag];
      } else {
        if (ownField && membership.property === ownField.property && ownField.value !== membership.value) {
          throw new Error('This column is excluded by the board membership filter.');
        }
        fields[membership.property] = membership.value;
      }
    }
  }
  if (ownField && ownField.value) fields[ownField.property] = ownField.value;

  const frontmatter = Object.keys(fields).length > 0
    ? `---\n${Object.entries(fields).map(([key, value]) => (
      `${key}: ${Array.isArray(value) ? `[${value.map((item) => JSON.stringify(item)).join(', ')}]` : JSON.stringify(value)}`
    )).join('\n')}\n---\n\n`
    : '';
  return { directory, fields, content: `${frontmatter}# ${normalizedTitle}\n` };
}

export function planKanbanCard(
  definition: BaseDefinition,
  viewIndex: number,
  basePath: string,
  workspacePath: string,
  title: string,
  groupValue: string,
): KanbanCardDraft {
  const view = definition.views[viewIndex];
  if (!view || view.type !== 'kanban') throw new Error('The selected view is not a Kanban board.');
  const group = kanbanProperty(view).replace(/^note\./, '');
  if (!kanbanWritableProperty(group) || !/^[\w.-]+$/u.test(group) || group === 'tags') {
    throw new Error('The column property is not a writable scalar note property.');
  }
  return planCard(definition, viewIndex, basePath, workspacePath, title, { property: group, value: groupValue });
}

export function planCalendarCard(
  definition: BaseDefinition,
  viewIndex: number,
  basePath: string,
  workspacePath: string,
  title: string,
  date: string,
): KanbanCardDraft {
  const view = definition.views[viewIndex];
  if (!view || view.type !== 'calendar') throw new Error('The selected view is not a calendar.');
  const property = calendarProperty(view).replace(/^note\./, '');
  if (!kanbanWritableProperty(property) || !/^[\w.-]+$/u.test(property) || property === 'tags') {
    throw new Error('The date property is not a writable scalar note property.');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) throw new Error('The date must use the YYYY-MM-DD form.');
  return planCard(definition, viewIndex, basePath, workspacePath, title, { property, value: date });
}
