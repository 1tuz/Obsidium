// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listVaultSnippetFiles, readFileSnapshot } from '../documents/fileGateway';
import { applyVaultSnippets, listVaultSnippets } from './vaultSnippets';

vi.mock('../documents/fileGateway', () => ({
  listVaultSnippetFiles: vi.fn(),
  readFileSnapshot: vi.fn(),
}));

const listFiles = vi.mocked(listVaultSnippetFiles);
const readSnapshot = vi.mocked(readFileSnapshot);

describe('vault CSS snippets', () => {
  beforeEach(() => {
    document.head.replaceChildren();
    listFiles.mockReset();
    readSnapshot.mockReset();
  });

  it('lists CSS files in stable name order', async () => {
    listFiles.mockResolvedValue([
      { id: '/vault/.obsidian/snippets/z.css', name: 'z.css', type: 'file' },
      { id: '/vault/.obsidian/snippets/skip.js', name: 'skip.js', type: 'file' },
      { id: '/vault/.obsidian/snippets/a.CSS', name: 'a.CSS', type: 'file' },
      { id: '/vault/.obsidian/snippets/folder', name: 'folder', type: 'folder' },
    ]);

    await expect(listVaultSnippets('/vault')).resolves.toEqual([
      { name: 'a.CSS', path: '/vault/.obsidian/snippets/a.CSS' },
      { name: 'z.css', path: '/vault/.obsidian/snippets/z.css' },
    ]);
  });

  it('loads enabled snippets and removes styles when disabled', async () => {
    listFiles.mockResolvedValue([
      { id: '/vault/.obsidian/snippets/compat.css', name: 'compat.css', type: 'file' },
      { id: '/vault/.obsidian/snippets/unused.css', name: 'unused.css', type: 'file' },
    ]);
    readSnapshot.mockResolvedValue({ content: '.markdown-preview-view { color: red; }', hash: '', textHash: '' });

    await applyVaultSnippets('/vault', { '/vault': ['compat.css'] });

    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(readSnapshot).toHaveBeenCalledWith('/vault/.obsidian/snippets/compat.css');
    expect(document.querySelector('style[data-obsidium-vault-snippet="compat.css"]')?.textContent)
      .toBe('.markdown-preview-view { color: red; }');

    await applyVaultSnippets('/vault', {});
    expect(document.querySelectorAll('style[data-obsidium-vault-snippet]')).toHaveLength(0);
  });

  it('matches enabled snippets by vault path and filename', async () => {
    listFiles.mockImplementation(async (vault) => [
      { id: `${vault}/.obsidian/snippets/foo.css`, name: 'foo.css', type: 'file' },
    ]);
    readSnapshot.mockImplementation(async (path) => ({
      content: path.includes('/vault-a/') ? '.a {}' : '.b {}', hash: '', textHash: '',
    }));

    await applyVaultSnippets('/vault-a', { '/vault-a': ['foo.css'] });
    await applyVaultSnippets('/vault-b', { '/vault-a': ['foo.css'] });

    expect(document.querySelectorAll('style[data-obsidium-vault-snippet]')).toHaveLength(0);
    await applyVaultSnippets('/vault-b', { '/vault-b': ['foo.css'] });
    expect(document.querySelector('style[data-obsidium-vault-snippet]')?.textContent).toBe('.b {}');
  });
});
