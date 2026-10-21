import type { ComponentChildren } from 'preact';
import { t } from '../../i18n';
import type { CanvasEdgeRoute } from '../../modules/canvas/interaction';
import {
  canvasFontFamilyCss,
  canvasFontSizePixels,
  canvasStrokeDasharray,
  type CanvasAppearance,
  type CanvasAppearancePatch,
  type CanvasCorners,
  type CanvasFontFamily,
  type CanvasFontSize,
  type CanvasStrokeStyle,
  type CanvasStrokeWidth,
  type CanvasTextAlign,
} from '../../modules/canvas/nodeProps';
import { canvasColorCss, canvasFillCss } from '../../modules/canvas/palette';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { CANVAS_GLYPHS } from './CanvasGlyphs';
import './CanvasPropertiesPanel.css';

export type CanvasPanelTarget =
  | { kind: 'nodes'; appearance: CanvasAppearance; count: number; canGroup: boolean; canUngroup: boolean; stroke?: string }
  | { kind: 'edge'; route: CanvasEdgeRoute; fromEnd: 'none' | 'arrow'; toEnd: 'none' | 'arrow'; label: string };

export interface CanvasPropertiesPanelProps {
  target: CanvasPanelTarget;
  onAppearance: (patch: CanvasAppearancePatch) => void;
  onStroke?: (color: string) => void;
  onFill?: (color: string | null) => void;
  onFront: () => void;
  onBack: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDelete: () => void;
  onRoute: (route: CanvasEdgeRoute) => void;
  onFromEnd: (end: 'none' | 'arrow') => void;
  onToEnd: (end: 'none' | 'arrow') => void;
  onLabel: (label: string) => void;
  onClose: () => void;
}

const PRESET_VALUES = ['1', '2', '3', '4', '5', '6'] as const;
const STROKE_WIDTHS: readonly CanvasStrokeWidth[] = [1, 2, 4];
const STROKE_STYLES: readonly CanvasStrokeStyle[] = ['solid', 'dashed', 'dotted'];
const CORNERS: readonly CanvasCorners[] = ['sharp', 'round'];
const FONT_FAMILIES: readonly CanvasFontFamily[] = ['sans', 'serif', 'mono'];
const FONT_SIZES: readonly CanvasFontSize[] = ['s', 'm', 'l', 'xl'];
const TEXT_ALIGNS: readonly CanvasTextAlign[] = ['left', 'center', 'right'];
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

const ALIGNMENT_LINES: Record<CanvasTextAlign, readonly (readonly [number, number])[]> = {
  left: [[3, 17], [3, 11], [3, 15], [3, 9]],
  center: [[3, 17], [6, 14], [4, 16], [7, 13]],
  right: [[3, 17], [9, 17], [5, 17], [11, 17]],
};

const GLYPH_HEIGHT = 13;

function EdgeGlyph({ children }: { children: ComponentChildren }) {
  return (
    <svg className="q-canvas-properties__glyph" width="16" height="10" viewBox="0 0 16 10" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      {children}
    </svg>
  );
}

function LineGlyph({ children, height }: { children: ComponentChildren; height: number }) {
  return (
    <svg className="q-canvas-properties__glyph" width="20" height={height} viewBox={`0 0 20 ${height}`} fill="none" stroke="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

function Section({ label, className, children }: { label: string; className?: string; children: ComponentChildren }) {
  return (
    <section className={className ? `q-canvas-properties__section ${className}` : 'q-canvas-properties__section'}>
      <span className="q-canvas-properties__label">{label}</span>
      <div className="q-canvas-properties__row" role="group" aria-label={label}>
        {children}
      </div>
    </section>
  );
}

function OptionButton({ label, pressed, onClick, children }: { label: string; pressed: boolean; onClick: () => void; children: ComponentChildren }) {
  return (
    <button
      type="button"
      className="q-canvas-properties__option"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Swatch({ label, pressed, color, variant, onClick }: { label: string; pressed: boolean; color?: string; variant?: 'ink' | 'none'; onClick: () => void }) {
  const className = variant
    ? `q-canvas-properties__swatch q-canvas-properties__swatch--${variant}`
    : 'q-canvas-properties__swatch';
  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      style={color ? { background: color } : undefined}
      onClick={onClick}
    />
  );
}

function NodeSections({ target, onAppearance, onStroke, onFill, onFront, onBack, onDuplicate, onGroup, onUngroup, onDelete }: {
  target: Extract<CanvasPanelTarget, { kind: 'nodes' }>;
  onAppearance: (patch: CanvasAppearancePatch) => void;
  onStroke?: (color: string) => void;
  onFill?: (color: string | null) => void;
  onFront: () => void;
  onBack: () => void;
  onDuplicate: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDelete: () => void;
}) {
  const { appearance, stroke = '' } = target;
  const opacityPercent = Math.round(appearance.opacity * 100);

  return (
    <>
      <Section label={t('canvas.props.stroke')} className="q-canvas-properties__section--stroke">
        <Swatch label={t('canvas.toolbar.color.default')} pressed={stroke === ''} variant="ink" onClick={() => onStroke?.('')} />
        {PRESET_VALUES.map((value) => (
          <Swatch
            key={value}
            label={t(`canvas.toolbar.color.${value}`)}
            pressed={stroke === value}
            color={canvasColorCss(value)}
            onClick={() => onStroke?.(value)}
          />
        ))}
      </Section>
      <Section label={t('canvas.props.background')} className="q-canvas-properties__section--background">
        <Swatch label={t('canvas.props.none')} pressed={appearance.fill === null} variant="none" onClick={() => onFill?.(null)} />
        {PRESET_VALUES.map((value) => (
          <Swatch
            key={value}
            label={t(`canvas.toolbar.color.${value}`)}
            pressed={appearance.fill === value}
            color={canvasFillCss(value)}
            onClick={() => onFill?.(value)}
          />
        ))}
      </Section>
      <Section label={t('canvas.props.strokeWidth')} className="q-canvas-properties__section--stroke-width">
        {STROKE_WIDTHS.map((width) => (
          <OptionButton key={width} label={t(`canvas.props.width.${width}`)} pressed={appearance.strokeWidth === width} onClick={() => onAppearance({ strokeWidth: width })}>
            <LineGlyph height={12}>
              <line x1="1" y1="6" x2="19" y2="6" strokeWidth={width} strokeLinecap="round" />
            </LineGlyph>
          </OptionButton>
        ))}
      </Section>
      <Section label={t('canvas.props.strokeStyle')} className="q-canvas-properties__section--stroke-style">
        {STROKE_STYLES.map((style) => (
          <OptionButton key={style} label={t(`canvas.props.style.${style}`)} pressed={appearance.strokeStyle === style} onClick={() => onAppearance({ strokeStyle: style })}>
            <LineGlyph height={12}>
              <line x1="1" y1="6" x2="19" y2="6" strokeWidth={2} strokeLinecap="round" strokeDasharray={canvasStrokeDasharray(style, 2)} />
            </LineGlyph>
          </OptionButton>
        ))}
      </Section>
      <Section label={t('canvas.props.corners')} className="q-canvas-properties__section--corners">
        {CORNERS.map((corner) => (
          <OptionButton key={corner} label={t(`canvas.props.corner.${corner}`)} pressed={appearance.corners === corner} onClick={() => onAppearance({ corners: corner })}>
            <LineGlyph height={14}>
              <rect x="3" y="2" width="14" height="10" rx={corner === 'round' ? 4 : 0} strokeWidth={1.5} />
            </LineGlyph>
          </OptionButton>
        ))}
      </Section>
      <Section label={t('canvas.props.fontFamily')} className="q-canvas-properties__section--font-family">
        {FONT_FAMILIES.map((family) => (
          <OptionButton key={family} label={t(`canvas.props.font.${family}`)} pressed={appearance.fontFamily === family} onClick={() => onAppearance({ fontFamily: family })}>
            <span className="q-canvas-properties__font" style={{ fontFamily: canvasFontFamilyCss(family) }}>Aa</span>
          </OptionButton>
        ))}
      </Section>
      <Section label={t('canvas.props.fontSize')} className="q-canvas-properties__section--font-size">
        {FONT_SIZES.map((size) => (
          <OptionButton key={size} label={t(`canvas.props.size.${size}`)} pressed={appearance.fontSize === size} onClick={() => onAppearance({ fontSize: size })}>
            <span className="q-canvas-properties__font" style={{ fontSize: `${canvasFontSizePixels(size)}px` }}>A</span>
          </OptionButton>
        ))}
      </Section>
      <Section label={t('canvas.props.textAlign')} className="q-canvas-properties__section--text-align">
        {TEXT_ALIGNS.map((align) => (
          <OptionButton key={align} label={t(`canvas.props.align.${align}`)} pressed={appearance.textAlign === align} onClick={() => onAppearance({ textAlign: align })}>
            <LineGlyph height={GLYPH_HEIGHT}>
              {ALIGNMENT_LINES[align].map(([x1, x2], index) => (
                <line key={index} x1={x1} y1={2 + index * 3} x2={x2} y2={2 + index * 3} strokeWidth={1.5} strokeLinecap="round" />
              ))}
            </LineGlyph>
          </OptionButton>
        ))}
      </Section>
      <section className="q-canvas-properties__section q-canvas-properties__section--opacity">
        <span className="q-canvas-properties__label-row">
          <span className="q-canvas-properties__label">{t('canvas.props.opacity')}</span>
          <span className="q-canvas-properties__value">{opacityPercent}%</span>
        </span>
        <input
          className="q-canvas-properties__range"
          type="range"
          min={0}
          max={100}
          step={1}
          value={opacityPercent}
          aria-label={t('canvas.props.opacity')}
          onInput={(event) => onAppearance({ opacity: Number(event.currentTarget.value) / 100 })}
        />
      </section>
      <Section label={t('canvas.props.layers')} className="q-canvas-properties__section--layers">
        <IconButton label={t('canvas.selection.front')} size="small" onClick={onFront}><Icon icon={CANVAS_GLYPHS.bringToFront} size={16} /></IconButton>
        <IconButton label={t('canvas.selection.back')} size="small" onClick={onBack}><Icon icon={CANVAS_GLYPHS.sendToBack} size={16} /></IconButton>
      </Section>
      <Section label={t('canvas.props.actions')} className="q-canvas-properties__section--actions">
        <IconButton label={t('canvas.selection.duplicate')} size="small" onClick={onDuplicate}><Icon icon={CANVAS_GLYPHS.duplicate} size={16} /></IconButton>
        <IconButton label={t('canvas.selection.group')} size="small" disabled={!target.canGroup} onClick={onGroup}><Icon icon={CANVAS_GLYPHS.group} size={16} /></IconButton>
        <IconButton label={t('canvas.selection.ungroup')} size="small" disabled={!target.canUngroup} onClick={onUngroup}><Icon icon={CANVAS_GLYPHS.ungroup} size={16} /></IconButton>
        <IconButton label={t('canvas.selection.delete')} size="small" onClick={onDelete}><Icon icon="trash2" size={16} /></IconButton>
      </Section>
    </>
  );
}

function EdgeSections({ target, onRoute, onFromEnd, onToEnd, onLabel, onDelete }: {
  target: Extract<CanvasPanelTarget, { kind: 'edge' }>;
  onRoute: (route: CanvasEdgeRoute) => void;
  onFromEnd: (end: 'none' | 'arrow') => void;
  onToEnd: (end: 'none' | 'arrow') => void;
  onLabel: (label: string) => void;
  onDelete: () => void;
}) {
  return (
    <>
      <section className="q-canvas-properties__section q-canvas-properties__section--route">
        <span className="q-canvas-properties__label">{t('canvas.props.route')}</span>
        <div className="q-canvas-properties__row" role="group" aria-label={t('canvas.props.route')}>
          {ROUTES.map((option) => (
            <OptionButton key={option} label={t(`canvas.route.${option}`)} pressed={target.route === option} onClick={() => onRoute(option)}>
              <EdgeGlyph>
                <path d={ROUTE_PATHS[option]} />
              </EdgeGlyph>
            </OptionButton>
          ))}
        </div>
      </section>
      <section className="q-canvas-properties__section q-canvas-properties__section--arrows">
        <span className="q-canvas-properties__label">{t('canvas.props.arrows')}</span>
        <div className="q-canvas-properties__row" role="group" aria-label={t('canvas.props.arrows')}>
          <OptionButton label={t('canvas.edge.startArrow')} pressed={target.fromEnd === 'arrow'} onClick={() => onFromEnd(target.fromEnd === 'arrow' ? 'none' : 'arrow')}>
            <EdgeGlyph>
              <path d={ARROW_GLYPHS.start.line} />
              <polygon points={ARROW_GLYPHS.start.head} />
            </EdgeGlyph>
          </OptionButton>
          <OptionButton label={t('canvas.edge.endArrow')} pressed={target.toEnd === 'arrow'} onClick={() => onToEnd(target.toEnd === 'arrow' ? 'none' : 'arrow')}>
            <EdgeGlyph>
              <path d={ARROW_GLYPHS.end.line} />
              <polygon points={ARROW_GLYPHS.end.head} />
            </EdgeGlyph>
          </OptionButton>
        </div>
      </section>
      <section className="q-canvas-properties__section q-canvas-properties__section--label">
        <input
          className="q-canvas-properties__input"
          type="text"
          value={target.label}
          placeholder={t('canvas.edgeLabel')}
          aria-label={t('canvas.edgeLabel')}
          onInput={(event) => onLabel(event.currentTarget.value)}
        />
      </section>
      <Section label={t('canvas.props.actions')} className="q-canvas-properties__section--actions">
        <IconButton label={t('canvas.selection.delete')} size="small" onClick={onDelete}><Icon icon="trash2" size={16} /></IconButton>
      </Section>
    </>
  );
}

export function CanvasPropertiesPanel({
  target,
  onAppearance,
  onStroke,
  onFill,
  onFront,
  onBack,
  onDuplicate,
  onGroup,
  onUngroup,
  onDelete,
  onRoute,
  onFromEnd,
  onToEnd,
  onLabel,
  onClose,
}: CanvasPropertiesPanelProps) {
  return (
    <div
      className="q-canvas-properties"
      role="dialog"
      aria-label={t('canvas.props.title')}
      data-target={target.kind}
    >
      <header className="q-canvas-properties__header">
        <span className="q-canvas-properties__title">{t('canvas.props.title')}</span>
        {target.kind === 'nodes' && target.count > 1 && (
          <span className="q-canvas-properties__count">{t('canvas.selectionCount', { count: target.count })}</span>
        )}
        <IconButton label={t('canvas.props.close')} size="small" onClick={onClose}><Icon icon="x" size={16} /></IconButton>
      </header>
      <div className="q-canvas-properties__body">
        {target.kind === 'nodes' ? (
          <NodeSections
            target={target}
            onAppearance={onAppearance}
            onStroke={onStroke}
            onFill={onFill}
            onFront={onFront}
            onBack={onBack}
            onDuplicate={onDuplicate}
            onGroup={onGroup}
            onUngroup={onUngroup}
            onDelete={onDelete}
          />
        ) : (
          <EdgeSections
            target={target}
            onRoute={onRoute}
            onFromEnd={onFromEnd}
            onToEnd={onToEnd}
            onLabel={onLabel}
            onDelete={onDelete}
          />
        )}
      </div>
    </div>
  );
}