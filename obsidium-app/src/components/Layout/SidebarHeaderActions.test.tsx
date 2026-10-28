// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { SidebarHeaderActions } from './SidebarHeaderActions';

describe('SidebarHeaderActions', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('offers note and folder creation in the knowledge base root', () => {
    const onCreateNote = vi.fn();
    const onCreateFolder = vi.fn();

    act(() => {
      renderer = mountDom(
        <SidebarHeaderActions onCreateNote={onCreateNote} onCreateFolder={onCreateFolder} />,
      );
    });

    const buttons = renderer!.container.querySelectorAll<HTMLButtonElement>('.q-sidebar-header-actions button');
    expect(Array.from(buttons, (button) => button.id)).toEqual(['file-plus', 'folder-plus']);

    act(() => buttons[0].click());
    act(() => buttons[1].click());

    expect(onCreateNote).toHaveBeenCalledTimes(1);
    expect(onCreateFolder).toHaveBeenCalledTimes(1);
  });

  it('adds a search action when the panel supplies one', () => {
    const onSearch = vi.fn();
    act(() => {
      renderer = mountDom(
        <SidebarHeaderActions onCreateNote={vi.fn()} onCreateFolder={vi.fn()} onSearch={onSearch} />,
      );
    });

    const buttons = renderer!.container.querySelectorAll<HTMLButtonElement>('.q-sidebar-header-actions button');
    expect(Array.from(buttons, (button) => button.id)).toEqual(['file-plus', 'folder-plus', 'search']);
    act(() => buttons[2].click());
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('disables both actions when no knowledge base is open', () => {
    act(() => {
      renderer = mountDom(
        <SidebarHeaderActions onCreateNote={vi.fn()} onCreateFolder={vi.fn()} disabled />,
      );
    });

    const buttons = renderer!.container.querySelectorAll<HTMLButtonElement>('.q-sidebar-header-actions button');
    expect(buttons).toHaveLength(2);
    expect(Array.from(buttons).every((button) => button.disabled)).toBe(true);
  });
});
