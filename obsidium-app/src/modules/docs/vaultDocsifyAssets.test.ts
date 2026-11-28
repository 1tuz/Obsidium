import { describe, expect, it, vi } from 'vitest';
import { docsifyAssetUrl } from './vaultDocsifyAssets';
import { resolveDocsifyAsset } from '../documents/fileGateway';

vi.mock('../documents/fileGateway', () => ({ resolveDocsifyAsset: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

describe('docsifyAssetUrl', () => {
  it('resolves the image for the source note and preserves the fallback', async () => {
    vi.mocked(resolveDocsifyAsset).mockResolvedValueOnce('/vault/manual/chapter/assets/a.png');
    expect(await docsifyAssetUrl('/vault', '/vault/manual/chapter/page.md', '/assets/a.png', 'fallback'))
      .toBe('asset:///vault/manual/chapter/assets/a.png');
    vi.mocked(resolveDocsifyAsset).mockResolvedValueOnce(null);
    expect(await docsifyAssetUrl('/vault', '/vault/other/page.md', '/assets/a.png', 'fallback'))
      .toBe('fallback');
  });
});
