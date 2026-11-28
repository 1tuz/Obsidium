// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { ImageEmbedWidget } from './widget';
import { docsifyAssetUrl } from '../../../../modules/docs/vaultDocsifyAssets';

vi.mock('../../../../modules/docs/vaultDocsifyAssets', () => ({ docsifyAssetUrl: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

describe('Docsify image widget', () => {
  it('loads an image using its source note', async () => {
    vi.mocked(docsifyAssetUrl).mockResolvedValue('asset:///vault/manual/chapter/assets/a.png');
    const widget = new ImageEmbedWidget({
      url: '', width: null, align: 'left', crop: null, kind: 'image', wikiTarget: null,
      workspacePath: '/vault', docsifyTarget: '/assets/a.png', notePath: '/vault/manual/chapter/page.md',
    });
    const root = widget.toDOM({ requestMeasure: vi.fn() } as unknown as EditorView);
    document.body.appendChild(root);
    await vi.waitFor(() => expect(root.querySelector('img')?.getAttribute('src'))
      .toBe('asset:///vault/manual/chapter/assets/a.png'));
    expect(docsifyAssetUrl).toHaveBeenCalledWith('/vault', '/vault/manual/chapter/page.md', '/assets/a.png', 'asset:///assets/a.png');
    root.remove();
  });
});
