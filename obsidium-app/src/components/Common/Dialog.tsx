import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { useStableCallback } from '../../hooks/useStableCallback';
import './Dialog.css';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableWithin(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
    .filter((element) => (
      element.tabIndex >= 0
      && !element.hasAttribute('hidden')
      && !element.closest('[inert]')
      && !element.closest('[aria-hidden="true"]')
    ));
}

function DialogHeader({ id, title, closeLabel, onClose }: {
  id: string;
  title: string;
  closeLabel?: string;
  onClose: () => void;
}) {
  return (
    <header className="q-dialog__header">
      <h2 id={id} className="q-dialog__title">{title}</h2>
      {closeLabel ? (
        <IconButton label={closeLabel} onClick={onClose}>
          <Icon icon={X} />
        </IconButton>
      ) : null}
    </header>
  );
}

export function DialogFooter({ align = 'end', children }: { align?: 'end' | 'center'; children: ReactNode }) {
  return (
    <footer className={`q-dialog__footer${align === 'center' ? ' q-dialog__footer--center' : ''}`}>
      {children}
    </footer>
  );
}

interface DialogProps {
  open: boolean;
  title: string;
  closeLabel?: string;
  headerless?: boolean;
  role?: 'dialog' | 'alertdialog';
  describedBy?: string;
  dismissible?: boolean;
  initialFocus?: () => void;
  className?: string;
  overlayClassName?: string;
  onClose: () => void;
  children: ReactNode;
}

export function Dialog({
  open,
  title,
  closeLabel,
  headerless = false,
  role = 'dialog',
  describedBy,
  dismissible = true,
  initialFocus,
  className = '',
  overlayClassName = '',
  onClose,
  children,
}: DialogProps) {
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const focusInitial = useStableCallback(() => {
    if (initialFocus) {
      initialFocus();
      return;
    }
    const panel = panelRef.current;
    if (!panel || panel.contains(document.activeElement)) return;
    const [first] = focusableWithin(panel);
    (first ?? panel).focus();
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    restoreRef.current = previous instanceof HTMLElement ? previous : null;
    const frame = requestAnimationFrame(focusInitial);
    return () => {
      cancelAnimationFrame(frame);
      const restore = restoreRef.current;
      restoreRef.current = null;
      if (restore?.isConnected) restore.focus();
    };
  }, [open, focusInitial]);

  const trapTab = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = focusableWithin(panel);
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !panel.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !panel.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const panel = panelRef.current;
      if (!panel) return;
      const dialogs = [...document.querySelectorAll('.q-dialog')];
      if (dialogs[dialogs.length - 1] !== panel) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [dismissible, onClose, open]);

  if (!open) return null;

  const dismiss = () => {
    if (dismissible) onClose();
  };

  return (
    <div
      className={`q-dialog-overlay ${overlayClassName}`.trim()}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && dismiss()}
    >
      <section
        ref={panelRef}
        tabIndex={-1}
        className={`q-dialog ${className}`.trim()}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            if (event.defaultPrevented) return;
            event.preventDefault();
            dismiss();
            return;
          }
          trapTab(event);
        }}
      >
        {headerless ? (
          <h2 id={titleId} className="q-visually-hidden">{title}</h2>
        ) : (
          <DialogHeader id={titleId} title={title} closeLabel={closeLabel} onClose={dismiss} />
        )}
        {children}
      </section>
    </div>
  );
}
