import { useEffect, useMemo, useRef, useState } from 'react';
import { Command, Search } from 'lucide';
import { Dialog } from '../Common/Dialog';
import { Icon } from '../Common/Icon';
import { formatShortcut } from '../../config/shortcuts';
import { t } from '../../i18n';
import type { CommandRegistry } from '../../modules/commands/registry';
import './CommandPalette.css';

interface CommandPaletteProps {
  open: boolean;
  registry: CommandRegistry;
  onClose: () => void;
}

export function CommandPalette({ open, registry, onClose }: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const commands = useMemo(() => registry.search(query), [query, registry]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIndex(0);
  }, [open]);

  useEffect(() => {
    setSelectedIndex((current) => Math.min(current, Math.max(commands.length - 1, 0)));
  }, [commands.length]);

  if (!open) return null;

  const execute = (id: string) => {
    onClose();
    void registry.execute(id).catch((error) => console.error('Failed to execute command', error));
  };

  return (
    <Dialog
      open
      headerless
      title={t('commands.title')}
      className="q-command-palette"
      initialFocus={() => inputRef.current?.focus()}
      onClose={onClose}
    >
      <div className="q-command-palette__search">
        <Icon icon={Search} />
        <input
          ref={inputRef}
          value={query}
          placeholder={t('commands.placeholder')}
          aria-label={t('commands.title')}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelectedIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              if (commands.length === 0) return;
              const direction = event.key === 'ArrowDown' ? 1 : -1;
              setSelectedIndex((index) => (index + direction + commands.length) % commands.length);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              const selected = commands[selectedIndex];
              if (selected) execute(selected.id);
            }
          }}
        />
      </div>

      <div className="q-command-palette__results" role="listbox" aria-label={t('commands.results')}>
        {commands.length === 0 ? (
          <p className="q-command-palette__empty">{t('commands.empty')}</p>
        ) : commands.map((command, index) => (
          <button
            key={command.id}
            type="button"
            className="q-command-palette__item"
            aria-selected={index === selectedIndex}
            role="option"
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => execute(command.id)}
          >
            <span className="q-command-palette__icon"><Icon icon={Command} /></span>
            <span className="q-command-palette__label">{command.title}</span>
            {command.shortcut && (
              <kbd className="q-command-palette__shortcut">{formatShortcut(command.shortcut)}</kbd>
            )}
          </button>
        ))}
      </div>
    </Dialog>
  );
}
