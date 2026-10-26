import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { t } from '../../i18n';
import { createUniqueFolder } from './folderFactory';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const taken = (names: string[]) => names.map((name) => ({
  id: `/vault/${name}`,
  name,
  type: 'folder' as const,
}));

describe('createUniqueFolder', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_directory') return [];
      return null;
    });
  });

  it('creates the default folder name in a free directory', async () => {
    const created = await createUniqueFolder('/vault');

    expect(created).toBe(`/vault/${t('fileTree.newFolderName')}`);
    expect(invokeMock).toHaveBeenCalledWith('ensure_directory', {
      path: `/vault/${t('fileTree.newFolderName')}`,
    });
  });

  it('picks a numbered name when the default folder already exists', async () => {
    const baseName = t('fileTree.newFolderName');
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_directory') return taken([baseName]);
      return null;
    });

    const created = await createUniqueFolder('/vault');

    expect(created).toBe(`/vault/${baseName} 1`);
  });

  it('retries after the file system reports an existing directory', async () => {
    const baseName = t('fileTree.newFolderName');
    const ensureMock = vi.fn(async () => {
      if (ensureMock.mock.calls.length === 1) throw { code: 'already_exists' };
      return null;
    });
    invokeMock.mockImplementation(async (command: string) => {
      if (command === 'read_directory') return [];
      if (command === 'ensure_directory') return ensureMock();
      return null;
    });

    const created = await createUniqueFolder('/vault', 'Проекты');

    expect(created).toBe('/vault/Проекты 1');
    expect(ensureMock).toHaveBeenCalledTimes(2);
    expect(baseName).not.toBe('Проекты');
  });

  it('returns null when the directory cannot be read', async () => {
    invokeMock.mockImplementation(async () => {
      throw { code: 'io' };
    });

    await expect(createUniqueFolder('/missing')).resolves.toBeNull();
  });
});
