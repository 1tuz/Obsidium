import { describe, expect, it } from 'vitest';
import type { WorkspaceItem } from '../../modules/documents/fileGateway';
import { buildVisibleFileRows, parseGuideDepths, unloadedExpandedFolders } from './fileTreeModel';

const folder: WorkspaceItem = { id: 'C:\\vault\\folder', name: 'folder', type: 'folder' };
const rootFile: WorkspaceItem = { id: 'C:\\vault\\root.md', name: 'root', type: 'file' };
const childFile: WorkspaceItem = { id: 'C:\\vault\\folder\\child.md', name: 'child', type: 'file' };
const nested: WorkspaceItem = { id: 'C:\\vault\\folder\\nested', name: 'nested', type: 'folder' };
const nestedFile: WorkspaceItem = { id: 'C:\\vault\\folder\\nested\\deep.md', name: 'deep', type: 'file' };

describe('file tree model', () => {
  it('keeps collapsed children out of the visible rows', () => {
    const rows = buildVisibleFileRows(
      [folder, rootFile],
      new Map([[folder.id, [childFile]]]),
      new Set(),
      new Set(),
    );

    expect(rows.map((row) => row.item.id)).toEqual([folder.id, rootFile.id]);
  });

  it('adds expanded children at the next depth', () => {
    const rows = buildVisibleFileRows(
      [folder],
      new Map([[folder.id, [childFile]]]),
      new Set([folder.id]),
      new Set(),
    );

    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      [folder.id, 0],
      [childFile.id, 1],
    ]);
  });

  it('shows a newly created item until a filtered tree refresh includes it', () => {
    const created = { id: '/vault/New note.md', name: 'New note', type: 'file' as const };
    const rows = buildVisibleFileRows(
      [],
      new Map([['/vault', []]]),
      new Set(),
      new Set(),
      '/vault',
      created,
    );

    expect(rows.map((row) => row.item.id)).toEqual([created.id]);
  });

  it('adds a created child to its expanded parent without duplicating refreshed items', () => {
    const parent = { id: '/vault/Projects', name: 'Projects', type: 'folder' as const };
    const created = { id: '/vault/Projects/New folder', name: 'New folder', type: 'folder' as const };
    const directories = new Map<string, WorkspaceItem[]>([['/vault', [parent]], [parent.id, []]]);
    const rows = buildVisibleFileRows(
      [parent],
      directories,
      new Set([parent.id]),
      new Set(),
      '/vault',
      created,
    );

    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      [parent.id, 0],
      [created.id, 1],
    ]);
    const refreshed = buildVisibleFileRows(
      [parent],
      new Map([...directories, [parent.id, [created]]]),
      new Set([parent.id]),
      new Set(),
      '/vault',
      created,
    );
    expect(refreshed.map((row) => row.item.id)).toEqual([parent.id, created.id]);
  });

  it('shows a created child when its visible parent has not loaded yet', () => {
    const parent = { id: '/vault/Projects', name: 'Projects', type: 'folder' as const };
    const created = { id: '/vault/Projects/New note.md', name: 'New note', type: 'file' as const };
    const rows = buildVisibleFileRows(
      [parent],
      new Map([['/vault', [parent]]]),
      new Set([parent.id]),
      new Set(),
      '/vault',
      created,
    );

    expect(rows.map((row) => [row.item.id, row.depth])).toEqual([
      [parent.id, 0],
      [created.id, 1],
    ]);
  });

  it('describes guide lines as a primitive so memoised rows survive a rebuild', () => {
    const args = [
      [folder, rootFile],
      new Map([[folder.id, [nested, childFile]], [nested.id, [nestedFile]]]),
      new Set([folder.id, nested.id]),
      new Set<string>(),
    ] as const;

    const rows = buildVisibleFileRows(...args);
    const rebuilt = buildVisibleFileRows(...args);

    expect(rows.map((row) => row.guideDepths)).toEqual(['', '0', '0,1', '0', '']);
    expect(rows.map((row) => row.guideDepths)).toEqual(rebuilt.map((row) => row.guideDepths));
    expect(parseGuideDepths(rows[2].guideDepths)).toEqual([0, 1]);
    expect(parseGuideDepths('')).toEqual([]);
  });

  it('names an expanded folder whose contents are not loaded yet', () => {
    const directories = new Map([[nested.id, [nestedFile]]]);
    const rows = buildVisibleFileRows([folder], directories, new Set([folder.id]), new Set());

    expect(unloadedExpandedFolders(rows, directories)).toEqual([folder.id]);
    expect(unloadedExpandedFolders(rows, new Map([[folder.id, []]]))).toEqual([]);
  });
});
