import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renameFile, writeFileAtomic } from './fileGateway';
import { renameWorkspaceFile } from './renameWorkspaceFile';

vi.mock('./fileGateway', () => ({
  isFileCommandError: vi.fn(() => false),
  isMarkdownPath: (path: string) => path.endsWith('.md'),
  renameFile: vi.fn(async () => ({ updatedPaths: [], content: '', hash: 'h', textHash: 't' })),
  writeFileAtomic: vi.fn(async () => ({ hash: 'next' })),
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

  it('keeps the Base extension and updates the first view name with the renamed snapshot hash', async () => {
    vi.mocked(renameFile).mockResolvedValue({ updatedPaths: [], content: 'views: []', hash: 'h', textHash: 'h' });
    const transform = (content: string, stem: string) => `${content}\nname: ${stem}`;

    const renamed = await renameWorkspaceFile('C:/vault/Old.base', 'Roadmap', transform);

    expect(renamed).toBe('C:/vault/Roadmap.base');
    expect(writeFileAtomic).toHaveBeenCalledWith('C:/vault/Roadmap.base', 'views: []\nname: Roadmap', 'h');
  });

  it('does not rename a Base to its current filename', async () => {
    expect(await renameWorkspaceFile('C:/vault/Old.base', 'Old')).toBeNull();
    expect(renameFile).not.toHaveBeenCalled();
  });
});
