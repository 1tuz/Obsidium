import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../modules/documents/renameWorkspaceFile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../modules/documents/renameWorkspaceFile')>();
  return { ...actual, moveWorkspaceEntry: vi.fn() };
});

const { moveWorkspaceEntry } = await import('../../modules/documents/renameWorkspaceFile');
const { moveIntoFolder } = await import('./moveIntoFolder');

afterEach(() => vi.clearAllMocks());

describe('moveIntoFolder', () => {
  it('rejects self, descendant, and same-parent moves without invoking rename', async () => {
    await expect(moveIntoFolder('/vault/Folder', '/vault/Folder')).resolves.toBeNull();
    await expect(moveIntoFolder('/vault/Folder', '/vault/Folder/Child')).resolves.toBeNull();
    await expect(moveIntoFolder('/vault/Folder/Note.md', '/VAULT/Folder/')).resolves.toBeNull();

    expect(moveWorkspaceEntry).not.toHaveBeenCalled();
  });

  it('moves into another folder and returns the claimed target path', async () => {
    vi.mocked(moveWorkspaceEntry).mockResolvedValue(undefined);

    await expect(moveIntoFolder('/vault/Source/Note.md', '/vault/Destination'))
      .resolves.toBe('/vault/Destination/Note.md');
    expect(moveWorkspaceEntry).toHaveBeenCalledWith(
      '/vault/Source/Note.md',
      '/vault/Destination/Note.md',
    );
  });

  it('chooses the next numbered name when the destination already exists', async () => {
    vi.mocked(moveWorkspaceEntry)
      .mockRejectedValueOnce({ code: 'already_exists' })
      .mockResolvedValueOnce(undefined);

    await expect(moveIntoFolder('/vault/Source/Note.md', '/vault/Destination'))
      .resolves.toBe('/vault/Destination/Note (1).md');
    expect(moveWorkspaceEntry).toHaveBeenNthCalledWith(
      1,
      '/vault/Source/Note.md',
      '/vault/Destination/Note.md',
    );
    expect(moveWorkspaceEntry).toHaveBeenNthCalledWith(
      2,
      '/vault/Source/Note.md',
      '/vault/Destination/Note (1).md',
    );
  });

  it('propagates non-conflict filesystem errors', async () => {
    const error = new Error('disk unavailable');
    vi.mocked(moveWorkspaceEntry).mockRejectedValue(error);

    await expect(moveIntoFolder('/vault/Source/Note.md', '/vault/Destination'))
      .rejects.toBe(error);
  });
});
