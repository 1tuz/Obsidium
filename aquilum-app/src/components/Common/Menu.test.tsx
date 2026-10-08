// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { Menu } from './Menu';

describe('Menu', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('stays open while its own list is scrolled', () => {
    const onClose = vi.fn();
    act(() => {
      renderer = mountDom(
        <Menu
          open
          position={{ top: 20, left: 20 }}
          items={Array.from({ length: 40 }, (_, index) => ({
            id: String(index), label: `Palette ${index}`, onSelect: vi.fn(),
          }))}
          onClose={onClose}
        />,
      );
    });

    const menu = document.querySelector('.q-menu')!;
    act(() => {
      menu.dispatchEvent(new Event('scroll'));
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('.q-menu')).not.toBeNull();
  });
});
