import { describe, expect, it } from 'vitest';
import type { WorkspaceItem } from '../modules/documents/fileGateway';
import { affectedDirectories, directoriesToRefresh } from './useWorkspaceEvents';

describe('workspace change routing', () => {
  it('refreshes only loaded parent directories', () => {
    const root = 'C:\\vault';
    const folder = 'C:\\vault\\folder';
    const collapsed = 'C:\\vault\\collapsed';
    const directories = new Map<string, WorkspaceItem[]>([
      [root, [
        { id: folder, name: 'folder', type: 'folder' },
        { id: collapsed, name: 'collapsed', type: 'folder' },
      ]],
      [folder, [{ id: `${folder}\\note.md`, name: 'note', type: 'file' }]],
    ]);

    expect(affectedDirectories(root, directories, [folder])).toEqual([root]);
    expect(affectedDirectories(root, directories, [`${folder}\\note.md`])).toEqual([folder]);
    expect(affectedDirectories(root, directories, [root])).toEqual([root]);
    expect(affectedDirectories(root, directories, [`${collapsed}\\note.md`])).toEqual([]);
  });

  it('shows a folder the tree has never seen', () => {
    const root = 'C:\\vault';
    const directories = new Map<string, WorkspaceItem[]>([[root, []]]);

    expect(affectedDirectories(root, directories, ['C:\\vault\\Templates\\Книга.md']))
      .toEqual([root]);
    expect(affectedDirectories(root, directories, ['C:\\vault\\Templates\\Глубже\\Книга.md']))
      .toEqual([root]);
  });
});

describe('full workspace rescan', () => {
  const root = 'C:\\vault';
  const folder = 'C:\\vault\\folder';
  const nested = 'C:\\vault\\folder\\nested';
  const directories = new Map<string, WorkspaceItem[]>([
    [root, [{ id: folder, name: 'folder', type: 'folder' }]],
    [folder, [{ id: nested, name: 'nested', type: 'folder' }]],
    [nested, []],
  ]);

  it('refreshes every loaded directory when the batch carries no paths', () => {
    expect(directoriesToRefresh(root, directories, [], true)).toEqual([root, folder, nested]);
  });

  it('keeps the path-scoped behaviour for ordinary changes', () => {
    expect(directoriesToRefresh(root, directories, [`${nested}\\note.md`], false)).toEqual([nested]);
  });
});
