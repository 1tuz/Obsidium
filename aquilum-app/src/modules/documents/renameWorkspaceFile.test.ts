import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renameFile } from './fileGateway';
import { renameWorkspaceFile } from './renameWorkspaceFile';

vi.mock('../docs', () => ({
  flushDocumentsUnder: vi.fn(),
  getManagedWriterForPath: vi.fn(() => null),
  getOpenDoc: vi.fn(() => null),
}));
vi.mock('../docSync', () => ({
  applyTextEdits: vi.fn(),
  documentText: vi.fn(),
  forgetSyncRecord: vi.fn(),
  mergeExternalChange: vi.fn(),
  writeSyncRecord: vi.fn(),
}));
vi.mock('../sync', () => ({ clearLocalDoc: vi.fn() }));
vi.mock('./fileGateway', () => ({
  isFileCommandError: vi.fn(() => false),
  isMarkdownPath: (path: string) => path.endsWith('.md'),
  readFileSnapshot: vi.fn(),
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
});
