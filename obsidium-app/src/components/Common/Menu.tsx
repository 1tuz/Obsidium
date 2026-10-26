import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as TargetedKeyboardEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, type IconNode } from 'lucide';
import { Icon } from './Icon';
import { animateMenuEntrance } from '../../modules/motion';
import './Menu.css';

export interface MenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  checked?: boolean;
  icon?: IconNode;
  onSelect: () => void;
}

export interface MenuPosition {
  top: number;
  left: number;
  width?: number;
}

interface MenuProps {
  id?: string;
  open: boolean;
  position: MenuPosition | null;
  items: MenuItem[];
  onClose: () => void;
  role?: 'listbox' | 'menu';
  ariaLabel?: string;
  showCheck?: boolean;
  excludeRef?: RefObject<HTMLElement | null>;
}

const VIEWPORT_MARGIN_PX = 8;

function firstEnabled(items: MenuItem[]): number {
  return items.findIndex((item) => !item.disabled);
}

function lastEnabled(items: MenuItem[]): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!items[index]!.disabled) return index;
  }
  return -1;
}

function stepEnabled(items: MenuItem[], from: number, step: number): number {
  const count = items.length;
  if (count === 0) return -1;
  let next = from;
  for (let attempt = 0; attempt < count; attempt += 1) {
    next = (next + step + count) % count;
    if (!items[next]!.disabled) return next;
  }
  return from;
}

export function Menu({
  id,
  open,
  position,
  items,
  onClose,
  role = 'menu',
  ariaLabel,
  showCheck = false,
  excludeRef,
}: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openedRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const baseId = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  const activeIndexSafe = items[activeIndex] && !items[activeIndex]!.disabled
    ? activeIndex
    : firstEnabled(items);
  const activeItem = activeIndexSafe >= 0 ? items[activeIndexSafe] : undefined;
  const activeId = activeItem ? `${baseId}-option-${activeIndexSafe}` : undefined;

  useLayoutEffect(() => {
    if (!open || !position) {
      openedRef.current = false;
      return;
    }
    if (openedRef.current) return;
    openedRef.current = true;
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setActiveIndex(firstEnabled(items));
  }, [items, open, position]);

  useLayoutEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[data-active]')?.focus();
  }, [activeIndexSafe, open]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !position || !menu) return;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${Math.max(VIEWPORT_MARGIN_PX, position.left - rect.width)}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${Math.max(VIEWPORT_MARGIN_PX, position.top - rect.height)}px`;
    }
  }, [open, position]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!open || !position || !menu) return;
    return animateMenuEntrance(menu);
  }, [open, position]);

  const restoreFocus = useCallback(() => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);

  const closeAndRestore = useCallback(() => {
    onClose();
    restoreFocus();
  }, [onClose, restoreFocus]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || excludeRef?.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      closeAndRestore();
    };

    const handleReposition = () => onClose();
    const handleScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [closeAndRestore, excludeRef, onClose, open]);

  const handleKeyDown = (event: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => stepEnabled(items, current, 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => stepEnabled(items, current, -1));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(firstEnabled(items));
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(lastEnabled(items));
      return;
    }
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
      if (!activeItem) return;
      event.preventDefault();
      event.stopPropagation();
      activeItem.onSelect();
      closeAndRestore();
    }
  };

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={menuRef}
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-activedescendant={activeId}
      className="q-menu"
      onKeyDown={handleKeyDown}
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          id={`${baseId}-option-${index}`}
          type="button"
          role={role === 'listbox' ? 'option' : 'menuitem'}
          aria-selected={role === 'listbox' ? Boolean(item.checked) : undefined}
          data-active={index === activeIndexSafe ? '' : undefined}
          tabIndex={index === activeIndexSafe ? 0 : -1}
          disabled={item.disabled}
          className="q-menu__item"
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
            closeAndRestore();
          }}
        >
          {item.icon && (
            <span className="q-menu__item-icon" aria-hidden="true">
              <Icon icon={item.icon} />
            </span>
          )}
          <span className="q-menu__item-label">{item.label}</span>
          {showCheck && item.checked && (
            <Icon icon={Check} className="q-menu__item-check" />
          )}
        </button>
      ))}
    </div>,
    document.body,
  );
}
