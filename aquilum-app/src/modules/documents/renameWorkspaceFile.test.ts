import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renameFile } from './fileGateway';
import { renameWorkspaceFile } from './renameWorkspaceFile';

vi.mock('./fileGateway', () => ({
  isFileCommandError: vi.fn(() => false),
  isMarkdownPath: (path: string) => path.endsWith('.md'),
  renameFile: vi.fn(async () => ({ updatedPaths: [], content: '', hash: 'h', textHash: 't' })),
}));

describe('renameWorkspaceFile', () => {
  beforeEach(() => vi.clearAllMocks());

  it('cleans the title the same way a new note name is cleaned', async () => {
    const renamed = await renameWorkspaceFile('C:/vault/Old.md', 'Работа/План?');

    expect(renamed).toBe('C:/vault/Работа План.md');
    expect(renameFile).toHaveBeenCalledWith('C:/vault/Old.md', 'C:/vault/Работа План.md');
  });

  it('does not rename into a name Windows reserves', async () => {
    const renamed = await renameWorkspaceFile('C:/vault/Old.md', 'con');

    expect(renamed).toBe('C:/vault/con note.md');
  });

  it('keeps a Base file extension when renaming a board', async () => {
    const renamed = await renameWorkspaceFile('C:/vault/Old.base', 'Roadmap');

    expect(renamed).toBe('C:/vault/Roadmap.base');
    expect(renameFile).toHaveBeenCalledWith('C:/vault/Old.base', 'C:/vault/Roadmap.base');
  });
});
