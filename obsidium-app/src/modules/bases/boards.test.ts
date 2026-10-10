import { describe, expect, it, vi } from 'vitest';
import { buildKanbanBase, scanKanbanBoards, type KanbanBoardCache } from './boards';
import { addToBoard, boardMembership, removeFromBoard } from './boardMembership';
import { parseBase } from './baseFormat';
import type { WorkspaceItem } from '../documents/fileGateway';

describe('scanKanbanBoards', () => {
  it('finds Kanban views in nested Base files and skips other view types', async () => {
    const directories: Record<string, WorkspaceItem[]> = {
      '/vault': [
        { id: '/vault/Work', name: 'Work', type: 'folder' },
        { id: '/vault/Personal.base', name: 'Personal.base', type: 'file' },
      ],
      '/vault/Work': [
        { id: '/vault/Work/Bugs.base', name: 'Bugs.base', type: 'file' },
        { id: '/vault/Work/Notes.md', name: 'Notes.md', type: 'file' },
      ],
    };
    const sources: Record<string, string> = {
      '/vault/Personal.base': 'views:\n  - type: table\n    name: All\n',
      '/vault/Work/Bugs.base': 'views:\n  - type: kanban\n    name: Bugs\n',
    };

    const boards = await scanKanbanBoards(
      '/vault',
      async (path) => directories[path] ?? [],
      async (path) => ({ content: sources[path], hash: path, textHash: path }),
    );

    expect(boards).toEqual([{
      path: '/vault/Work/Bugs.base',
      name: 'Bugs',
      views: [{ index: 0, name: 'Bugs', membership: { kind: 'unsupported', reason: 'This board includes the whole vault and has no membership property or tag.' } }],
    }]);
  });

  it('keeps multiple Kanban views in one Base as separately addressable views', async () => {
    const readDirectory = vi.fn(async () => [
      { id: '/vault/Projects.base', name: 'Projects.base', type: 'file' as const },
    ]);
    const readFileSnapshot = async () => ({
      content: 'views:\n  - type: kanban\n    name: By status\n  - type: table\n    name: Table\n  - type: kanban\n    name: By owner\n',
      hash: '1',
      textHash: '1',
    });

    const boards = await scanKanbanBoards('/vault', readDirectory, readFileSnapshot);

    expect(boards[0].views).toEqual([
      { index: 0, name: 'By status', membership: { kind: 'unsupported', reason: 'This board includes the whole vault and has no membership property or tag.' } },
      { index: 2, name: 'By owner', membership: { kind: 'unsupported', reason: 'This board includes the whole vault and has no membership property or tag.' } },
    ]);
  });

  it('creates ordinary Kanban Base YAML with an initial source filter and group order', () => {
    const raw = buildKanbanBase({
      name: 'Sprint',
      groupBy: 'status',
      columns: ['backlog', 'todo', 'doing', 'done'],
      source: { kind: 'tag', tag: 'sprint' },
    });
    const base = parseBase(raw);

    expect(base.filters).toBe('file.hasTag("sprint")');
    expect(base.views).toMatchObject([{
      type: 'kanban',
      name: 'Sprint',
      groupBy: { property: 'status' },
      groupOrder: ['backlog', 'todo', 'doing', 'done'],
    }]);
  });

  it('supports folder, property, whole-vault, and custom sources in compatible Base filters', () => {
    const build = (source: Parameters<typeof buildKanbanBase>[0]['source']) => (
      parseBase(buildKanbanBase({ name: 'Board', source, groupBy: 'status', columns: ['todo'] })).filters
    );

    expect(build({ kind: 'folder', folder: 'Work/Bugs' })).toBe('file.inFolder("Work/Bugs")');
    expect(build({ kind: 'property', property: 'project', value: 'Atlas' }))
      .toBe('project == "Atlas"');
    expect(build({ kind: 'wholeVault' })).toBeUndefined();
    expect(build({ kind: 'custom', filter: 'priority >= 2' })).toBe('priority >= 2');
  });

  it('rejects a property source that conflicts with the first Kanban group', () => {
    expect(() => buildKanbanBase({
      name: 'Status board',
      source: { kind: 'property', property: 'status', value: 'active' },
      groupBy: 'status',
      columns: ['todo', 'done'],
    })).toThrow(/first column/u);
  });

  it('refreshes after Base creation, modification, and deletion', async () => {
    const cache: KanbanBoardCache = new Map();
    const directory: WorkspaceItem[] = [];
    const sources: Record<string, { content: string; hash: string }> = {};
    const readDirectory = async () => [...directory];
    const readFileSnapshot = async (path: string) => ({
      ...sources[path],
      textHash: sources[path].hash,
    });
    const scan = () => scanKanbanBoards('/vault', readDirectory, readFileSnapshot, cache);

    expect(await scan()).toEqual([]);

    directory.push({ id: '/vault/Work.base', name: 'Work.base', type: 'file' });
    sources['/vault/Work.base'] = { content: 'views:\n  - type: kanban\n    name: Work\n', hash: '1' };
    expect((await scan()).map((board) => board.views[0].name)).toEqual(['Work']);

    sources['/vault/Work.base'] = { content: 'views:\n  - type: kanban\n    name: Updated\n', hash: '2' };
    expect((await scan()).map((board) => board.views[0].name)).toEqual(['Updated']);

    directory.splice(0, 1);
    delete sources['/vault/Work.base'];
    expect(await scan()).toEqual([]);
    expect(cache.size).toBe(0);
  });
});

describe('board membership', () => {
  it('adds and removes only the property that defines board membership', () => {
    const definition = parseBase('filters: "project == \\\"atlas\\\""\nviews:\n  - type: kanban\n    name: Atlas\n    groupBy:\n      property: status\n    groupOrder: [todo, doing]\n');
    const source = '---\ntitle: Keep\ncustom: untouched\n---\nBody\n';

    const added = addToBoard(source, boardMembership(definition, 0), 'todo');
    expect(added).toContain('project: "atlas"');
    expect(added).toContain('status: "todo"');
    expect(added).toContain('custom: untouched');

    const removed = removeFromBoard(added, boardMembership(definition, 0));
    expect(removed).not.toMatch(/project:/);
    expect(removed).toContain('status: "todo"');
    expect(removed).toContain('custom: untouched');
  });

  it('adds and removes only the matching board tag', () => {
    const definition = parseBase('filters: "file.hasTag(\\\"sprint\\\")"\nviews:\n  - type: kanban\n    name: Sprint\n    groupBy:\n      property: status\n    groupOrder: [todo]\n');
    const source = '---\ntags: [keep, existing]\n---\nBody\n';
    const membership = boardMembership(definition, 0);

    const added = addToBoard(source, membership, 'todo');
    expect(added).toContain('tags: ["keep", "existing", "sprint"]');
    expect(removeFromBoard(added, membership)).toContain('tags: ["keep", "existing"]');
  });

  it('removes only tags matching the board tag hierarchy', () => {
    const definition = parseBase('filters: "file.hasTag(\\\"sprint\\\")"\nviews:\n  - type: kanban\n    name: Sprint\n    groupBy:\n      property: status\n    groupOrder: [todo]\n');
    const source = '---\ntags: [keep, sprint, sprint/urgent]\nstatus: todo\n---\nBody\n';

    expect(removeFromBoard(source, boardMembership(definition, 0)))
      .toContain('tags: ["keep"]');
  });

  it('does not replace conflicting membership or group values', () => {
    const definition = parseBase('filters: "project == \\\"atlas\\\""\nviews:\n  - type: kanban\n    name: Atlas\n    groupBy:\n      property: status\n    groupOrder: [todo]\n');
    const source = '---\nproject: another\nstatus: done\ncustom: keep\n---\nBody\n';
    const membership = boardMembership(definition, 0);

    expect(addToBoard(source, membership, 'todo')).toBe(source);
    expect(removeFromBoard(source, membership)).toBe(source);
  });

  it('does not overwrite array metadata when membership or grouping is a list', () => {
    const membershipDefinition = parseBase('filters: "tags == \\\"sprint\\\""\nviews:\n  - type: kanban\n    name: Sprint\n    groupBy:\n      property: status\n    groupOrder: [todo]\n');
    const source = '---\ntags: [keep, existing]\nstatus: [todo, done]\n---\nBody\n';
    const membership = boardMembership(membershipDefinition, 0);

    expect(addToBoard(source, membership, 'todo')).toBe(source);
    expect(removeFromBoard(source, membership)).toBe(source);
  });

  it('refuses compound custom filters and leaves metadata unchanged', () => {
    const definition = parseBase([
      'filters:',
      '  and:',
      '    - \'project == "atlas"\'',
      '    - \'priority == "high"\'',
      'views:',
      '  - type: kanban',
      '    name: Atlas',
      '    groupBy:',
      '      property: status',
      '    groupOrder: [todo]',
    ].join('\n'));
    const source = '---\nproject: elsewhere\nstatus: done\ncustom: untouched\n---\nBody\n';
    const membership = boardMembership(definition, 0);

    expect(membership.kind).toBe('unsupported');
    expect(addToBoard(source, membership, 'todo')).toBe(source);
    expect(removeFromBoard(source, membership)).toBe(source);
  });
});
