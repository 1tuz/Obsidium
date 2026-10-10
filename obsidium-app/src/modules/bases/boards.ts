import {
  isBasePath,
  type FileSnapshot,
  type WorkspaceItem,
} from '../documents/fileGateway';
import { parseBase } from './baseFormat';
import { kanbanWritableProperty } from './kanban';
import { boardMembership, type BoardMembership } from './boardMembership';

export interface KanbanBoardView {
  index: number;
  name: string;
  membership: BoardMembership;
}

export interface KanbanBoard {
  path: string;
  name: string;
  views: KanbanBoardView[];
}

export type KanbanBoardSource =
  | { kind: 'folder'; folder: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'property'; property: string; value: string }
  | { kind: 'wholeVault' }
  | { kind: 'custom'; filter: string };

export interface NewKanbanBoard {
  name: string;
  source: KanbanBoardSource;
  groupBy: string;
  columns: string[];
}

export type KanbanBoardCache = Map<string, { hash: string; board: KanbanBoard | null }>;

function quoted(value: string): string {
  return JSON.stringify(value);
}

function sourceFilter(source: KanbanBoardSource): string | null {
  switch (source.kind) {
    case 'folder':
      return source.folder.trim() ? `file.inFolder(${quoted(source.folder.trim())})` : null;
    case 'tag':
      return source.tag.trim() ? `file.hasTag(${quoted(source.tag.trim().replace(/^#/, ''))})` : null;
    case 'property':
      return /^[\w.-]+$/u.test(source.property) && source.value.trim()
        ? `${source.property} == ${quoted(source.value.trim())}`
        : null;
    case 'wholeVault':
      return null;
    case 'custom':
      return source.filter.trim() || null;
  }
}

export function buildKanbanBase(input: NewKanbanBoard): string {
  const name = input.name.trim();
  const groupBy = input.groupBy.trim();
  const columns = input.columns.map((column) => column.trim()).filter(Boolean);
  if (!name || !groupBy || !kanbanWritableProperty(groupBy) || columns.length === 0) {
    throw new Error('Board name, writable group property, and at least one column are required');
  }
  const filter = sourceFilter(input.source);
  if (input.source.kind !== 'wholeVault' && !filter) {
    throw new Error('Board source is incomplete');
  }
  if (input.source.kind === 'property'
    && input.source.property.replace(/^note\./, '') === groupBy.replace(/^note\./, '')
    && input.source.value.trim() !== columns[0]) {
    throw new Error('The first column must match the property membership value');
  }
  const lines = [
    ...(filter ? [`filters: ${quoted(filter)}`] : []),
    'views:',
    '  - type: kanban',
    `    name: ${quoted(name)}`,
    '    groupBy:',
    `      property: ${quoted(groupBy)}`,
    '    groupOrder:',
    ...columns.map((column) => `      - ${quoted(column)}`),
    '',
  ];
  return lines.join('\n');
}

export async function scanKanbanBoards(
  root: string,
  readDirectory: (path: string) => Promise<WorkspaceItem[]>,
  readFileSnapshot: (path: string) => Promise<FileSnapshot>,
  cache: KanbanBoardCache = new Map(),
): Promise<KanbanBoard[]> {
  const files: string[] = [];
  const visited = new Set<string>();

  const visit = async (directory: string): Promise<void> => {
    if (visited.has(directory)) return;
    visited.add(directory);
    for (const item of await readDirectory(directory)) {
      if (item.type === 'folder') await visit(item.id);
      else if (isBasePath(item.id)) files.push(item.id);
    }
  };

  await visit(root);
  const boards = await Promise.all(files.map(async (path): Promise<KanbanBoard | null> => {
    const snapshot = await readFileSnapshot(path).catch(() => null);
    if (!snapshot) {
      cache.delete(path);
      return null;
    }
    const cached = cache.get(path);
    if (cached?.hash === snapshot.hash) return cached.board;
    const definition = parseBase(snapshot.content);
    const views = definition.views.flatMap((view, index) => (
      view.type === 'kanban' ? [{ index, name: view.name, membership: boardMembership(definition, index) }] : []
    ));
    const board = views.length > 0
      ? {
        path,
        name: path.split(/[\\/]/).pop()?.replace(/\.base$/i, '') ?? path,
        views,
      }
      : null;
    cache.set(path, { hash: snapshot.hash, board });
    return board;
  }));

  const existing = new Set(files);
  for (const path of cache.keys()) {
    if (!existing.has(path)) cache.delete(path);
  }

  return boards.filter((board): board is KanbanBoard => board !== null)
    .sort((left, right) => left.path.localeCompare(right.path, undefined, { sensitivity: 'base' }));
}
