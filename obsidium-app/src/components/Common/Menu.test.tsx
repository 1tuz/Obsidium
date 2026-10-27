// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { Menu, type MenuEntry, type MenuItem } from './Menu';

function items(onSelect: (id: string) => void, count = 4): MenuItem[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(index),
    label: `Item ${index}`,
    onSelect: () => onSelect(String(index)),
  }));
}

function keydown(target: Element, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function activeItem(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.q-menu__item[data-active]');
}

describe('Menu', () => {
  let renderer: MountedDom | null = null;
  let innerWidthDescriptor: PropertyDescriptor | undefined;
  let innerHeightDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    innerWidthDescriptor = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    innerHeightDescriptor = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    document.documentElement.dataset.motion = 'off';
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    vi.restoreAllMocks();
    if (innerWidthDescriptor) Object.defineProperty(window, 'innerWidth', innerWidthDescriptor);
    if (innerHeightDescriptor) Object.defineProperty(window, 'innerHeight', innerHeightDescriptor);
  });

  it('stays open while its own list is scrolled', () => {
    const onClose = vi.fn();
    act(() => {
      renderer = mountDom(
        <Menu
          open
          position={{ top: 20, left: 20 }}
          items={items(vi.fn(), 40)}
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

  it('focuses the first menu item without using active descendant on the menu', () => {
    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: 20, left: 20 }} items={items(vi.fn())} onClose={vi.fn()} />,
      );
    });

    const menu = document.querySelector('.q-menu')!;
    const first = activeItem();

    expect(first?.textContent).toBe('Item 0');
    expect(menu.hasAttribute('aria-activedescendant')).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  it('cycles the active item with arrow keys and jumps with Home and End', () => {
    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: 20, left: 20 }} items={items(vi.fn())} onClose={vi.fn()} />,
      );
    });
    const menu = document.querySelector('.q-menu')!;

    keydown(menu, 'ArrowDown');
    expect(activeItem()?.textContent).toBe('Item 1');

    keydown(menu, 'ArrowDown');
    keydown(menu, 'ArrowDown');
    keydown(menu, 'ArrowDown');
    expect(activeItem()?.textContent).toBe('Item 0');

    keydown(menu, 'ArrowUp');
    expect(activeItem()?.textContent).toBe('Item 3');

    keydown(menu, 'Home');
    expect(activeItem()?.textContent).toBe('Item 0');

    keydown(menu, 'End');
    expect(activeItem()?.textContent).toBe('Item 3');
    expect(menu.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('skips disabled items while navigating', () => {
    const list = items(vi.fn());
    list[1]!.disabled = true;
    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: 20, left: 20 }} items={list} onClose={vi.fn()} />,
      );
    });
    const menu = document.querySelector('.q-menu')!;

    keydown(menu, 'ArrowDown');
    expect(activeItem()?.textContent).toBe('Item 2');
  });

  it('skips typed separators and renders shortcut and danger metadata', () => {
    const menuItems: MenuEntry[] = [
      { id: 'first', label: 'First', onSelect: vi.fn() },
      { id: 'separator', type: 'separator' },
      { id: 'danger', label: 'Delete', shortcut: '⌘⌫', danger: true, onSelect: vi.fn() },
    ];
    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: 20, left: 20 }} items={menuItems} onClose={vi.fn()} />,
      );
    });
    const menu = document.querySelector('.q-menu')!;

    keydown(menu, 'ArrowDown');

    expect(activeItem()?.textContent).toContain('Delete');
    expect(document.querySelector('[role="separator"]')).not.toBeNull();
    expect(document.querySelector('.q-menu__shortcut')?.textContent).toBe('⌘⌫');
    expect(activeItem()?.classList.contains('q-menu__item--danger')).toBe(true);
  });

  it('uses roving focus for menus and active descendant for listboxes', () => {
    act(() => {
      renderer = mountDom(
        <Menu
          open
          role="listbox"
          position={{ top: 20, left: 20 }}
          items={items(vi.fn())}
          onClose={vi.fn()}
        />,
      );
    });
    const listbox = document.querySelector('.q-menu')!;
    const option = activeItem()!;

    expect(document.activeElement).toBe(listbox);
    expect(listbox.getAttribute('aria-activedescendant')).toBe(option.id);
    expect(option.getAttribute('role')).toBe('option');
    expect(option.getAttribute('tabindex')).toBe('-1');
    keydown(listbox, 'ArrowDown');
    expect(listbox.getAttribute('aria-activedescendant')).toBe(activeItem()?.id);
    expect(document.activeElement).toBe(listbox);

    act(() => {
      renderer?.unmount();
      renderer = mountDom(
        <Menu open position={{ top: 20, left: 20 }} items={items(vi.fn())} onClose={vi.fn()} />,
      );
    });
    const menu = document.querySelector('.q-menu')!;
    const menuItem = activeItem()!;

    expect(document.activeElement).toBe(menuItem);
    expect(menu.hasAttribute('aria-activedescendant')).toBe(false);
    expect(menuItem.getAttribute('role')).toBe('menuitem');
  });

  it('clamps measured position inside every viewport edge', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 300 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, top: 0, left: 0, right: 120, bottom: 80, width: 120, height: 80,
      toJSON: () => ({}),
    });

    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: -10, left: -20 }} items={items(vi.fn())} onClose={vi.fn()} />,
      );
    });
    let menu = document.querySelector<HTMLElement>('.q-menu')!;
    expect(menu.style.left).toBe('8px');
    expect(menu.style.top).toBe('8px');

    act(() => renderer?.unmount());
    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: 190, left: 290 }} items={items(vi.fn())} onClose={vi.fn()} />,
      );
    });
    menu = document.querySelector<HTMLElement>('.q-menu')!;
    expect(menu.style.left).toBe('172px');
    expect(menu.style.top).toBe('112px');
  });

  it('selects the active item with Enter and closes', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: 20, left: 20 }} items={items(onSelect)} onClose={onClose} />,
      );
    });
    const menu = document.querySelector('.q-menu')!;

    keydown(menu, 'ArrowDown');
    expect(keydown(menu, 'Enter').defaultPrevented).toBe(true);

    expect(onSelect).toHaveBeenCalledWith('1');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on Escape and restores focus to the opener', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();

    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: 20, left: 20 }} items={items(vi.fn())} onClose={onClose} />,
      );
    });
    expect(document.activeElement).not.toBe(trigger);

    keydown(document.querySelector('.q-menu')!, 'Escape');

    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('closes on Tab and restores focus to the opener', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();

    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: 20, left: 20 }} items={items(vi.fn())} onClose={onClose} />,
      );
    });

    keydown(document.querySelector('.q-menu')!, 'Tab');

    expect(onClose).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
