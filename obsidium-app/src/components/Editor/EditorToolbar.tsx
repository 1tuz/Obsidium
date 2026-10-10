import { t } from '../../i18n';
import { ArrowLeft, ArrowRight, BookOpen, MoreHorizontal, Pencil, Search } from 'lucide';
import { Icon } from '../Common/Icon';
import { Button } from '../Common/Button';
import { IconButton } from '../Common/IconButton';
import { Menu, type MenuItem, type MenuPosition } from '../Common/Menu';
import { useCallback, useMemo, useRef, useState } from 'react';
import './EditorToolbar.css';

const MENU_WIDTH = 200;

interface EditorToolbarProps {
  fileName: string;
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
}

export function EditorToolbar({
  fileName,
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
}: EditorToolbarProps) {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const close = useCallback(() => setPosition(null), []);
  const items: MenuItem[] = useMemo(() => [
    { id: 'export-pdf', label: t('editor.exportPdf'), onSelect: onExportPdf },
  ], [onExportPdf]);
  const openMenu = () => {
    const bounds = triggerRef.current?.getBoundingClientRect();
    if (bounds) {
      setPosition({ top: bounds.bottom + 4, left: bounds.right - MENU_WIDTH, width: MENU_WIDTH });
    }
  };
  return <div className="q-editor-toolbar">
    <div className="q-editor-toolbar__side">
      {!focusMode && <>
        <IconButton label={t('editor.back')} size="medium" disabled={!canGoBack} onClick={() => onNavigate(-1)}><Icon icon={ArrowLeft} /></IconButton>
        <IconButton label={t('editor.forward')} size="medium" disabled={!canGoForward} onClick={() => onNavigate(1)}><Icon icon={ArrowRight} /></IconButton>
      </>}
    </div>
    {!focusMode && <div className="q-editor-toolbar__name" title={fileName}>{fileName}</div>}
    <div className="q-editor-toolbar__side">
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
