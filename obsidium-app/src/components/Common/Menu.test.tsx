// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { Menu, type MenuItem } from './Menu';

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

  beforeEach(() => {
    document.documentElement.dataset.motion = 'off';
  });

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

  it('focuses the first item and exposes it as the active descendant', () => {
    act(() => {
      renderer = mountDom(
        <Menu open position={{ top: 20, left: 20 }} items={items(vi.fn())} onClose={vi.fn()} />,
      );
    });

    const menu = document.querySelector('.q-menu')!;
    const first = activeItem();

    expect(first?.textContent).toBe('Item 0');
    expect(menu.getAttribute('aria-activedescendant')).toBe(first?.id);
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
    expect(menu.getAttribute('aria-activedescendant')).toBe(activeItem()?.id);
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
});
