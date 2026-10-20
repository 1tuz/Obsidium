import type { ComponentChildren } from 'preact';
import { t } from '../../i18n';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { canvasPixels } from '../../modules/canvas/renderStyle';
import { CANVAS_GLYPHS } from './CanvasGlyphs';
import './CanvasSelectionToolbar.css';

interface CanvasSelectionToolbarProps {
  x: number;
  y: number;
  canGroup: boolean;
  canUngroup: boolean;
  onFront: () => void;
  onBack: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}

interface ToolbarActionProps {
  label: string;
  icon: Parameters<typeof Icon>[0]['icon'];
  onClick: () => void;
  disabled?: boolean;
  children?: ComponentChildren;
}

function ToolbarAction({ label, icon, onClick, disabled = false }: ToolbarActionProps) {
  return (
    <IconButton label={label} size="small" disabled={disabled} onClick={onClick}>
      <Icon icon={icon} size={16} />
    </IconButton>
  );
}

export function CanvasSelectionToolbar({
  x,
  y,
  canGroup,
  canUngroup,
  onFront,
  onBack,
  onDuplicate,
  onGroup,
  onUngroup,
  onDelete,
}: CanvasSelectionToolbarProps) {
  return (
    <div
      className="q-canvas__selection-toolbar"
      role="toolbar"
      aria-label={t('canvas.selection.label')}
      style={{ left: canvasPixels(x), top: canvasPixels(y) }}
    >
      <ToolbarAction label={t('canvas.selection.front')} icon={CANVAS_GLYPHS.bringToFront} onClick={onFront} />
      <ToolbarAction label={t('canvas.selection.back')} icon={CANVAS_GLYPHS.sendToBack} onClick={onBack} />
      <ToolbarAction label={t('canvas.selection.duplicate')} icon={CANVAS_GLYPHS.duplicate} onClick={onDuplicate} />
      <ToolbarAction label={t('canvas.selection.group')} icon={CANVAS_GLYPHS.group} onClick={onGroup} disabled={!canGroup} />
      <ToolbarAction label={t('canvas.selection.ungroup')} icon={CANVAS_GLYPHS.ungroup} onClick={onUngroup} disabled={!canUngroup} />
      <ToolbarAction label={t('canvas.selection.delete')} icon="trash2" onClick={onDelete} />
    </div>
  );
}
