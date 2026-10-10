import { describe, expect, it } from 'vitest';
import { buildKanbanBase } from './boards';
import { parseBase } from './baseFormat';
import { planKanbanCard } from './cardCreation';
import { evaluateBaseFilter } from './filter';

const vault = '/vault';
const basePath = '/vault/Projects/Tasks.base';
const plan = (source: Parameters<typeof buildKanbanBase>[0]['source'], groupValue = 'todo') => (
  planKanbanCard(parseBase(buildKanbanBase({
    name: 'Tasks', source, groupBy: 'status', columns: ['backlog', 'todo', 'doing', 'done'],
  })), 0, basePath, vault, 'Implement search', groupValue)
);

describe('Kanban card creation', () => {
  it('creates a note in the board directory for a whole-vault board', () => {
    expect(plan({ kind: 'wholeVault' }, 'doing')).toMatchObject({
      directory: '/vault/Projects',
      fields: { status: 'doing' },
      content: '---\nstatus: "doing"\n---\n\n# Implement search\n',
    });
  });

  it('creates folder-filtered cards in the matching folder', () => {
    const draft = plan({ kind: 'folder', folder: 'Work/Bugs' }, 'done');
    expect(draft.directory).toBe('/vault/Work/Bugs');
    expect(draft.fields).toEqual({ status: 'done' });
  });

  it('creates visible cards for tag and property membership filters', () => {
    for (const source of [
      { kind: 'tag' as const, tag: 'sprint' },
      { kind: 'property' as const, property: 'project', value: 'atlas' },
    ]) {
      const definition = parseBase(buildKanbanBase({
        name: 'Tasks', source, groupBy: 'status', columns: ['todo', 'doing'],
      }));
      const draft = planKanbanCard(definition, 0, basePath, vault, 'A task', 'doing');
      const row = { path: '/vault/Projects/A task.md', fields: draft.fields };
      expect(evaluateBaseFilter(definition.filters, row, vault)).toEqual({ match: true, unsupported: false });
      expect(draft.fields.status).toBe('doing');
    }
  });

  it('refuses automatic card creation for unsafe folder paths and custom filters', () => {
    expect(() => plan({ kind: 'folder', folder: '../private' })).toThrow(/inside the vault/u);
    expect(() => plan({ kind: 'custom', filter: 'priority >= 2' })).toThrow();
  });

  it('refuses a group that the membership filter excludes', () => {
    const definition = parseBase(buildKanbanBase({
      name: 'Tasks', source: { kind: 'property', property: 'status', value: 'todo' },
      groupBy: 'status', columns: ['todo', 'done'],
    }));
    expect(() => planKanbanCard(definition, 0, basePath, vault, 'A task', 'done'))
      .toThrow(/excluded/u);
  });

  it('does not assign a status when adding to the unassigned column', () => {
    expect(plan({ kind: 'wholeVault' }, '').fields).toEqual({});
  });
});
