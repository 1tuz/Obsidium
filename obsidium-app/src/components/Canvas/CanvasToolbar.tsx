import { t } from '../../i18n';
import { Circle, FileCode, FileText, GitBranch, Image, Link2, ListOrdered, MousePointer2, Pencil, Redo2, Search, Square, Type, Undo2, Users } from 'lucide';
import { Icon } from '../Common/Icon';
import { rhombus, stickerGlyph } from './CanvasGlyphs';
import { IconButton } from '../Common/IconButton';
import './CanvasToolbar.css';

export type CanvasPaperStyle = 'paper-white' | 'ivory' | 'parchment' | 'sepia' | 'dark-paper';
export type CanvasGrid = 'none' | 'dots' | 'lines';
export type CanvasTool = 'select' | 'text' | 'file' | 'link' | 'group' | 'edge' | 'rectangle' | 'diamond' | 'ellipse' | 'number' | 'draw' | 'sticker';

interface CanvasToolbarProps {
  paperStyle: CanvasPaperStyle;
  grid: CanvasGrid;
  activeTool: CanvasTool;
  canUndo: boolean;
  canRedo: boolean;
  onPaperStyleChange: (style: CanvasPaperStyle) => void;
  onGridChange: (grid: CanvasGrid) => void;
  onOpenSlash: () => void;
  onToolChange: (tool: CanvasTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onAddNote?: () => void;
  onExportSvg?: () => void;
  onExportPng?: () => void;
}

const tools = [
  { id: 'select', label: 'select', icon: MousePointer2, shortcut: 'V' },
  { id: 'text', label: 'text', icon: Type, shortcut: 'T' },
  { id: 'file', label: 'file', icon: FileText, shortcut: 'F' },
  { id: 'link', label: 'link', icon: Link2, shortcut: 'L' },
  { id: 'group', label: 'group', icon: Users, shortcut: 'G' },
  { id: 'edge', label: 'edge', icon: GitBranch, shortcut: 'A' },
  { id: 'rectangle', label: 'rectangle', icon: Square, shortcut: 'R' },
  { id: 'diamond', label: 'diamond', icon: rhombus, shortcut: 'D' },
  { id: 'ellipse', label: 'ellipse', icon: Circle, shortcut: 'E' },
  { id: 'number', label: 'number', icon: ListOrdered, shortcut: 'N' },
  { id: 'sticker', label: 'sticker', icon: stickerGlyph, shortcut: 'S' },
  { id: 'draw', label: 'draw', icon: Pencil, shortcut: 'P' },
] as const;

export function CanvasToolbar({
  paperStyle,
  grid,
  activeTool,
  canUndo,
  canRedo,
  onPaperStyleChange,
  onGridChange,
  onOpenSlash,
  onToolChange,
  onUndo,
  onRedo,
  onAddNote,
  onExportSvg,
  onExportPng,
}: CanvasToolbarProps) {
  return (
    <div className="q-canvas-toolbar" role="toolbar" aria-label={t('canvas.toolbar.label')}>
      <div className="q-canvas-toolbar__tools" role="group" aria-label={t('canvas.toolbar.tools')}>
        {tools.map(({ id, label, icon, shortcut }) => (
          <IconButton
            key={id}
            label={t(`canvas.toolbar.tool.${label}`)}
            title={`${t(`canvas.toolbar.tool.${label}`)} (${shortcut})`}
            size="medium"
            aria-pressed={activeTool === id}
            aria-keyshortcuts={shortcut}
            onClick={() => onToolChange(id)}
          >
            <Icon icon={icon} />
            <kbd className="q-canvas-toolbar__key" aria-hidden="true">{shortcut}</kbd>
          </IconButton>
        ))}
      </div>
      {onAddNote && <div className="q-canvas-toolbar__group q-canvas-toolbar__divider" role="group">
        <IconButton label={t('canvas.toolbar.addNote')} size="medium" onClick={onAddNote}><Icon icon={Search} /></IconButton>
      </div>}
      <button type="button" className="q-canvas-toolbar__slash q-canvas-toolbar__divider" onClick={onOpenSlash}>{t('canvas.slash.open')}</button>
      <div className="q-canvas-toolbar__history q-canvas-toolbar__divider" role="group" aria-label={t('canvas.toolbar.history')}>
        <IconButton label={t('canvas.toolbar.undo')} size="medium" disabled={!canUndo} onClick={onUndo}><Icon icon={Undo2} /></IconButton>
        <IconButton label={t('canvas.toolbar.redo')} size="medium" disabled={!canRedo} onClick={onRedo}><Icon icon={Redo2} /></IconButton>
      </div>
      <label className="q-canvas-toolbar__setting q-canvas-toolbar__divider">
        <span>{t('canvas.toolbar.paperStyle')}</span>
        <select aria-label={t('canvas.toolbar.paperStyle')} value={paperStyle} onChange={(event) => onPaperStyleChange(event.currentTarget.value as CanvasPaperStyle)}>
          {(['paper-white', 'ivory', 'parchment', 'sepia', 'dark-paper'] as const).map(style => (
            <option key={style} value={style}>{t(`settings.editor.styles.${style}`)}</option>
          ))}
        </select>
      </label>
      <label className="q-canvas-toolbar__setting">
        <span>{t('canvas.toolbar.grid')}</span>
        <select aria-label={t('canvas.toolbar.grid')} value={grid} onChange={(event) => onGridChange(event.currentTarget.value as CanvasGrid)}>
          {(['none', 'dots', 'lines'] as const).map(style => (
            <option key={style} value={style}>{t(`canvas.toolbar.gridStyle.${style}`)}</option>
          ))}
        </select>
      </label>
      {(onExportSvg || onExportPng) && (
        <div className="q-canvas-toolbar__group" role="group" aria-label={t('canvas.toolbar.export')}>
          {onExportSvg && <IconButton label={t('canvas.toolbar.exportSvg')} size="medium" onClick={onExportSvg}><Icon icon={FileCode} /></IconButton>}
          {onExportPng && <IconButton label={t('canvas.toolbar.exportPng')} size="medium" onClick={onExportPng}><Icon icon={Image} /></IconButton>}
        </div>
      )}
    </div>
  );
}