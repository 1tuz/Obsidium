import { t } from '../../i18n';
import { ArrowLeft, ArrowRight, BookOpen, Check, MoreHorizontal, Pencil, Search } from 'lucide';
import { Icon } from '../Common/Icon';
import { Button } from '../Common/Button';
import { IconButton } from '../Common/IconButton';
import { Menu, type MenuItem, type MenuPosition } from '../Common/Menu';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './EditorToolbar.css';

const MENU_WIDTH = 200;

interface EditorToolbarProps {
  fileName: string;
  noteName?: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onNavigate: (delta: -1 | 1) => void;
  onSearch: () => void;
  onExportPdf: () => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  readOnly: boolean;
  onModeChange: (readOnly: boolean) => void;
  showModeToggle?: boolean;
  onRename?: (name: string) => Promise<boolean>;
  onSave?: () => Promise<void>;
  saving?: boolean;
  saveError?: string | null;
}

export function EditorToolbar({
  fileName,
  noteName,
  canGoBack,
  canGoForward,
  onNavigate,
  onSearch,
  onExportPdf,
  focusMode,
  onToggleFocusMode,
  readOnly,
  onModeChange,
  showModeToggle = true,
  onRename,
  onSave,
  saving = false,
  saveError = null,
}: EditorToolbarProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [draft, setDraft] = useState(noteName ?? '');
  const [editingName, setEditingName] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const committedRef = useRef(noteName ?? '');
  const close = useCallback(() => setPosition(null), []);
  const items: MenuItem[] = useMemo(() => [
    { id: 'export-pdf', label: t('editor.exportPdf'), onSelect: onExportPdf },
  ], [onExportPdf]);

  useEffect(() => {
    if (!editingName) setDraft(noteName ?? '');
  }, [editingName, noteName]);

  useEffect(() => {
    if (status === 'idle') return undefined;
    const timer = window.setTimeout(() => setStatus('idle'), 1800);
    return () => window.clearTimeout(timer);
  }, [status]);

  const commitName = async (value: string) => {
    setEditingName(false);
    const next = value.trim();
    const current = noteName ?? '';
    if (!onRename || !next || next === current || next === committedRef.current) {
      setDraft(current);
      return;
    }
    committedRef.current = next;
    const renamed = await onRename(next);
    if (!renamed) {
      committedRef.current = current;
      setDraft(current);
      return;
    }
    setDraft(next);
  };

  const saveNow = async () => {
    if (!onSave) return;
    try {
      await onSave();
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  const openMenu = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) {
      setPosition({ top: bounds.bottom + 4, left: bounds.right - MENU_WIDTH, width: MENU_WIDTH });
    }
  };

  const editableName = Boolean(onRename) && !readOnly;

  return <div className="q-editor-toolbar">
    <div className="q-editor-toolbar__side">
      {!focusMode && <>
        <IconButton label={t('editor.back')} size="medium" disabled={!canGoBack} onClick={() => onNavigate(-1)}><Icon icon={ArrowLeft} /></IconButton>
        <IconButton label={t('editor.forward')} size="medium" disabled={!canGoForward} onClick={() => onNavigate(1)}><Icon icon={ArrowRight} /></IconButton>
      </>}
    </div>
    {!focusMode && <div className="q-editor-toolbar__name">
      {editableName ? (
        <input
          className="q-editor-toolbar__name-input"
          aria-label={t('editor.nameLabel')}
          title={t('editor.nameHint')}
          value={draft}
          spellcheck={false}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onFocus={() => setEditingName(true)}
          onBlur={(event) => { void commitName(event.currentTarget.value); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void commitName(event.currentTarget.value);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(noteName ?? '');
              committedRef.current = noteName ?? '';
              setEditingName(false);
            }
          }}
        />
      ) : <span className="q-editor-toolbar__name-text" title={fileName}>{fileName}</span>}
      {saveError ? <span className="q-editor-toolbar__save q-editor-toolbar__save--error" role="alert">{t('editor.saveFailedShort')}</span>
        : saving || status === 'saved' ? <span className="q-editor-toolbar__save" role="status">{saving ? t('editor.saving') : t('editor.saved')}</span> : null}
    </div>}
    <div className="q-editor-toolbar__side">
      {onSave && !readOnly && <IconButton label={t('editor.saveNow')} size="medium" onClick={() => { void saveNow(); }}><Icon icon={Check} /></IconButton>}
      {showModeToggle && <>
        <IconButton
          label={t(readOnly ? 'editor.readingMode' : 'editor.editingMode')}
          size="medium"
          aria-pressed={readOnly}
          onClick={() => onModeChange(!readOnly)}
        ><Icon icon={readOnly ? BookOpen : Pencil} /></IconButton>
      </>}
      <Button variant="ghost" size="xs" aria-pressed={focusMode} onClick={onToggleFocusMode}>{t('editor.focusMode')}</Button>
      {!focusMode && <IconButton label={t('editor.searchInNote')} size="medium" onClick={onSearch}><Icon icon={Search} /></IconButton>}
      <span ref={triggerRef}><IconButton label={t('editor.noteActions')} size="medium" aria-expanded={Boolean(position)} onClick={openMenu}><Icon icon={MoreHorizontal} /></IconButton></span>
      <Menu open={Boolean(position)} position={position} items={items} onClose={close} ariaLabel={t('editor.noteActions')} excludeRef={triggerRef} />
    </div>
  </div>;
}
