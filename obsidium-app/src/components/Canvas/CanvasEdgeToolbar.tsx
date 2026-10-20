import type { ComponentChildren } from 'preact';
import { t } from '../../i18n';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import type { CanvasEdgeRoute } from '../../modules/canvas/interaction';
import { canvasPixels } from '../../modules/canvas/renderStyle';
import './CanvasEdgeToolbar.css';

export interface CanvasEdgeToolbarProps {
  x: number;
  y: number;
  route: CanvasEdgeRoute;
  fromEnd: 'none' | 'arrow';
  toEnd: 'none' | 'arrow';
  label: string;
  onRouteChange: (route: CanvasEdgeRoute) => void;
  onFromEndChange: (end: 'none' | 'arrow') => void;
  onToEndChange: (end: 'none' | 'arrow') => void;
  onLabelChange: (label: string) => void;
  onDelete: () => void;
}

const ROUTES: readonly CanvasEdgeRoute[] = ['straight', 'elbow', 'curved'];

const ROUTE_PATHS: Record<CanvasEdgeRoute, string> = {
  straight: 'M1 5h14',
  elbow: 'M2 1.5V5h13',
  curved: 'M1 5C5 5 8 1.5 15 1.5',
};

const ARROW_GLYPHS = {
  start: { line: 'M6.5 5h8.5', head: '1,5 6.5,1.75 6.5,8.25' },
  end: { line: 'M1 5h8.5', head: '15,5 9.5,1.75 9.5,8.25' },
} as const;

function EdgeGlyph({ children }: { children: ComponentChildren }) {
  return (
    <svg
      width="16"
      height="10"
      viewBox="0 0 16 10"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function CanvasEdgeToolbar({
  x,
  y,
  route,
  fromEnd,
  toEnd,
  label,
  onRouteChange,
  onFromEndChange,
  onToEndChange,
  onLabelChange,
  onDelete,
}: CanvasEdgeToolbarProps) {
  return (
    <div
      className="q-canvas__edge-toolbar"
      role="toolbar"
      aria-label={t('canvas.edge.toolbar')}
      style={{ left: canvasPixels(x), top: canvasPixels(y) }}
    >
      {ROUTES.map((option) => (
        <IconButton
          key={option}
          label={t(`canvas.route.${option}`)}
          size="small"
          aria-pressed={route === option}
          onClick={() => onRouteChange(option)}
        >
          <EdgeGlyph>
            <path d={ROUTE_PATHS[option]} />
          </EdgeGlyph>
        </IconButton>
      ))}
      <IconButton
        label={t('canvas.edge.startArrow')}
        size="small"
        aria-pressed={fromEnd === 'arrow'}
        onClick={() => onFromEndChange(fromEnd === 'arrow' ? 'none' : 'arrow')}
      >
        <EdgeGlyph>
          <path d={ARROW_GLYPHS.start.line} />
          <polygon points={ARROW_GLYPHS.start.head} />
        </EdgeGlyph>
      </IconButton>
      <IconButton
        label={t('canvas.edge.endArrow')}
        size="small"
        aria-pressed={toEnd === 'arrow'}
        onClick={() => onToEndChange(toEnd === 'arrow' ? 'none' : 'arrow')}
      >
        <EdgeGlyph>
          <path d={ARROW_GLYPHS.end.line} />
          <polygon points={ARROW_GLYPHS.end.head} />
        </EdgeGlyph>
      </IconButton>
      <input
        type="text"
        value={label}
        aria-label={t('canvas.edgeLabel')}
        placeholder={t('canvas.edgeLabel')}
        onInput={(event) => onLabelChange(event.currentTarget.value)}
      />
      <IconButton label={t('canvas.menu.delete')} size="small" onClick={onDelete}>
        <Icon icon="trash2" size={16} />
      </IconButton>
    </div>
  );
}