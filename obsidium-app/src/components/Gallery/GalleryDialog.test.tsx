// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { GalleryDialog } from './GalleryDialog';

const galleryMocks = vi.hoisted(() => ({
  listWorkspaceImages: vi.fn(),
}));

vi.mock('../../modules/gallery/gateway', () => ({
  listWorkspaceImages: galleryMocks.listWorkspaceImages,
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

const IMAGES = [
  { path: '/vault/Files/old.png', size: 10, mtime: 1_000 },
  { path: '/vault/Files/fresh.jpg', size: 20, mtime: 5_000 },
];

describe('GalleryDialog', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    vi.clearAllMocks();
  });

  async function openGallery(onClose = vi.fn()) {
    galleryMocks.listWorkspaceImages.mockResolvedValue(IMAGES);
    await actAndSettle(() => {
      renderer = mountDom(<GalleryDialog open workspacePath="/vault" onClose={onClose} />);
    });
    return onClose;
  }

  it('renders every workspace image as a lazy preview, freshest first', async () => {
    await openGallery();

    expect(galleryMocks.listWorkspaceImages).toHaveBeenCalledWith('/vault');
    const tiles = [...document.querySelectorAll<HTMLElement>('.q-gallery-tile')];
    expect(tiles).toHaveLength(2);
    expect(tiles.map((tile) => tile.textContent)).toEqual(['fresh.jpg', 'old.png']);

    const preview = tiles[0].querySelector('img');
    expect(preview?.getAttribute('src')).toBe('asset:///vault/Files/fresh.jpg');
    expect(preview?.getAttribute('loading')).toBe('lazy');
  });

  it('opens the full size on click, walks with the arrow keys and closes on Escape', async () => {
    const onClose = await openGallery();
    const tiles = [...document.querySelectorAll<HTMLElement>('.q-gallery-tile')];

    await actAndSettle(() => {
      tiles[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const viewerImage = () => document.querySelector('.q-gallery-viewer__image');
    expect(viewerImage()?.getAttribute('src')).toBe('asset:///vault/Files/fresh.jpg');

    await actAndSettle(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(viewerImage()?.getAttribute('src')).toBe('asset:///vault/Files/old.png');

    await actAndSettle(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(viewerImage()?.getAttribute('src')).toBe('asset:///vault/Files/fresh.jpg');

    await actAndSettle(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(document.querySelector('.q-gallery-viewer')).toBeNull();
    expect(document.querySelectorAll('.q-gallery-tile')).toHaveLength(2);
    expect(onClose).not.toHaveBeenCalled();

    await actAndSettle(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state for a vault without images', async () => {
    galleryMocks.listWorkspaceImages.mockResolvedValue([]);
    await actAndSettle(() => {
      renderer = mountDom(<GalleryDialog open workspacePath="/vault" onClose={vi.fn()} />);
    });

    expect(document.querySelector('.q-gallery-grid')).toBeNull();
    expect(document.querySelector('.q-gallery-empty')).not.toBeNull();
  });
});
