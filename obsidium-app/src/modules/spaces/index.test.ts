import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  DEFAULT_SPACE_ID,
  buildSpaceDirectories,
  deleteSpace,
  folderOptions,
  getSpaces,
  isWholeVaultSpace,
  listSpaceFiles,
  saveSpace,
  type Space,
} from './index';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const wholeVault: Space = {
  id: DEFAULT_SPACE_ID,
  name: 'All notes',
  root: '',
  includeTags: [],
  excludeFolders: [],
};

describe('buildSpaceDirectories', () => {
  it('nests every parent chain from the workspace down to each file folder', () => {
    const directories = buildSpaceDirectories('/vault', [
      '/vault/beta/Note.md',
      '/vault/alpha/zeta.md',
      '/vault/alpha/Alpha.canvas',
      '/vault/top.md',
      '/vault/aaa.md',
      '/vault/Board.base',
      '/outside/ignored.md',
    ]);

    expect([...directories.keys()].sort()).toEqual(['/vault', '/vault/alpha', '/vault/beta']);
    expect(directories.get('/vault')).toEqual([
      { id: '/vault/alpha', name: 'alpha', type: 'folder' },
      { id: '/vault/beta', name: 'beta', type: 'folder' },
      { id: '/vault/aaa.md', name: 'aaa', type: 'file' },
      { id: '/vault/Board.base', name: 'Board.base', type: 'file' },
      { id: '/vault/top.md', name: 'top', type: 'file' },
    ]);
    expect(directories.get('/vault/alpha')).toEqual([
      { id: '/vault/alpha/Alpha.canvas', name: 'Alpha.canvas', type: 'file' },
      { id: '/vault/alpha/zeta.md', name: 'zeta', type: 'file' },
    ]);
    expect(directories.get('/vault/beta')).toEqual([
      { id: '/vault/beta/Note.md', name: 'Note', type: 'file' },
    ]);
  });

  it('drops paths outside the workspace and duplicates', () => {
    const directories = buildSpaceDirectories('/vault', [
      '/vault/note.md',
      '/vault/note.md',
      '/vault/../escape.md',
      '/vaulting/other.md',
    ]);

    expect([...directories.keys()]).toEqual(['/vault']);
    expect(directories.get('/vault')).toEqual([
      { id: '/vault/note.md', name: 'note', type: 'file' },
    ]);
  });

  it('handles Windows separators', () => {
    const directories = buildSpaceDirectories('C:\\vault', [
      'C:\\vault\\a\\note.md',
      'C:\\vault\\root.md',
    ]);

    expect([...directories.keys()]).toEqual(['C:\\vault', 'C:\\vault\\a']);
    expect(directories.get('C:\\vault')).toEqual([
      { id: 'C:\\vault\\a', name: 'a', type: 'folder' },
      { id: 'C:\\vault\\root.md', name: 'root', type: 'file' },
    ]);
    expect(directories.get('C:\\vault\\a')).toEqual([
      { id: 'C:\\vault\\a\\note.md', name: 'note', type: 'file' },
    ]);
    expect(folderOptions('C:\\vault', ['C:\\vault\\a\\note.md'])).toEqual(['a']);
  });
});

describe('folderOptions', () => {
  it('lists vault-relative folders once, without the root, sorted', () => {
    expect(folderOptions('/vault', [
      '/vault/alpha/beta/note.md',
      '/vault/alpha/other.md',
      '/vault/zeta.md',
      '/elsewhere/note.md',
    ])).toEqual(['alpha', 'alpha/beta']);
  });
});

describe('isWholeVaultSpace', () => {
  it('treats an unfiltered space as the whole vault', () => {
    expect(isWholeVaultSpace(null)).toBe(true);
    expect(isWholeVaultSpace(wholeVault)).toBe(true);
    expect(isWholeVaultSpace({ ...wholeVault, root: 'projects' })).toBe(false);
    expect(isWholeVaultSpace({ ...wholeVault, includeTags: ['work'] })).toBe(false);
    expect(isWholeVaultSpace({ ...wholeVault, excludeFolders: ['archive'] })).toBe(false);
  });
});

describe('space commands', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('lists spaces', async () => {
    invokeMock.mockResolvedValue([wholeVault]);

    await expect(getSpaces()).resolves.toEqual([wholeVault]);
    expect(invokeMock).toHaveBeenCalledWith('get_spaces');
  });

  it('saves a space', async () => {
    invokeMock.mockResolvedValue(wholeVault);

    await expect(saveSpace(wholeVault)).resolves.toEqual(wholeVault);
    expect(invokeMock).toHaveBeenCalledWith('save_space', { space: wholeVault });
  });

  it('deletes a space and returns the remaining list', async () => {
    invokeMock.mockResolvedValue([wholeVault]);

    await expect(deleteSpace('work')).resolves.toEqual([wholeVault]);
    expect(invokeMock).toHaveBeenCalledWith('delete_space', { id: 'work' });
  });

  it('lists space files for a space and for the whole vault', async () => {
    invokeMock.mockResolvedValue(['/vault/note.md']);

    await expect(listSpaceFiles('/vault', 'work')).resolves.toEqual(['/vault/note.md']);
    await listSpaceFiles('/vault', null);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'list_space_files', {
      workspacePath: '/vault',
      spaceId: 'work',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'list_space_files', {
      workspacePath: '/vault',
      spaceId: null,
    });
  });
});
