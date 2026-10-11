import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import {
  createFile,
  isCanvasPath,
  isFileCommandError,
  isPdfPath,
  isTextFilePath,
  readFileSnapshot,
  renameFile,
  writeFileAtomic,
} from './fileGateway';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

describe('workspace file types', () => {
  it('recognises standard UTF-8 text formats without accepting binary files', () => {
    expect(isTextFilePath('config.yml')).toBe(true);
    expect(isTextFilePath('board.canvas')).toBe(true);
    expect(isTextFilePath('BOARD.CANVAS')).toBe(true);
    expect(isCanvasPath('BOARD.CANVAS')).toBe(true);
    expect(isCanvasPath('board.canvas.md')).toBe(false);
    expect(isTextFilePath('src/main.rs')).toBe(true);
    expect(isTextFilePath('image.png')).toBe(false);
    expect(isTextFilePath('.env')).toBe(false);
  });

  it('recognises PDF files case-insensitively', () => {
    expect(isPdfPath('Manual.PDF')).toBe(true);
    expect(isPdfPath('Manual.epub')).toBe(false);
  });
});

describe('fileGateway', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('reads a typed file snapshot', async () => {
    invokeMock.mockResolvedValue({ content: 'text', hash: 'hash' });

    await expect(readFileSnapshot('note.md')).resolves.toEqual({
      content: 'text',
      hash: 'hash',
    });
    expect(invokeMock).toHaveBeenCalledWith('read_file_snapshot', {
      path: 'note.md',
    });
  });

  it('passes the expected hash to atomic writes', async () => {
    invokeMock.mockResolvedValue({ hash: 'new-hash' });

    await writeFileAtomic('note.md', 'next', 'old-hash');

    expect(invokeMock).toHaveBeenCalledWith('write_file_atomic', {
      path: 'note.md',
      content: 'next',
      expectedHash: 'old-hash',
      source: { kind: 'edit' },
    });
  });

  it('uses no write precondition until a baseline is available', async () => {
    invokeMock.mockResolvedValue({ hash: 'new-hash' });

    await writeFileAtomic('note.md', 'next');

    expect(invokeMock).toHaveBeenCalledWith('write_file_atomic', {
      path: 'note.md',
      content: 'next',
      expectedHash: null,
      source: { kind: 'edit' },
    });
  });

  it('creates and renames files through dedicated commands', async () => {
    invokeMock.mockResolvedValue({ content: '', hash: 'hash', updatedPaths: [] });

    await createFile('new.md');
    await renameFile('new.md', 'renamed.md');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'create_file', {
      path: 'new.md',
      content: '',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'rename_file', {
      oldPath: 'new.md',
      newPath: 'renamed.md',
    });
  });

  it('recognizes structured command errors', () => {
    const error = { code: 'already_exists', details: { path: 'note.md' } };

    expect(isFileCommandError(error)).toBe(true);
    expect(isFileCommandError(error, 'already_exists')).toBe(true);
    expect(isFileCommandError(error, 'conflict')).toBe(false);
    expect(isFileCommandError(new Error('failure'))).toBe(false);
  });
});
