// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { ImageFilePane } from './ImageFilePane';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

describe('ImageFilePane', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('opens a workspace image from the asset protocol with an accessible name', () => {
    act(() => { renderer = mountDom(<ImageFilePane path="/vault/architecture.svg" />); });

    const image = renderer!.container.querySelector('img');
    expect(image?.getAttribute('src')).toBe('asset:///vault/architecture.svg');
    expect(image?.getAttribute('alt')).toBe('architecture.svg');
  });
});
