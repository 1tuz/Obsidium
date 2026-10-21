import { isRecord, type CanvasNode } from './model';

export type CanvasStrokeWidth = 1 | 2 | 4;
export type CanvasStrokeStyle = 'solid' | 'dashed' | 'dotted';
export type CanvasCorners = 'sharp' | 'round';
export type CanvasFontFamily = 'sans' | 'serif' | 'mono';
export type CanvasFontSize = 's' | 'm' | 'l' | 'xl';
export type CanvasTextAlign = 'left' | 'center' | 'right';

export type CanvasAppearance = {
  strokeWidth: CanvasStrokeWidth;
  strokeStyle: CanvasStrokeStyle;
  corners: CanvasCorners;
  fontFamily: CanvasFontFamily;
  fontSize: CanvasFontSize;
  textAlign: CanvasTextAlign;
  opacity: number;
  fill: string | null;
};

export type CanvasAppearancePatch = Partial<CanvasAppearance>;

const STROKE_WIDTHS: readonly CanvasStrokeWidth[] = [1, 2, 4];
const STROKE_STYLES: readonly CanvasStrokeStyle[] = ['solid', 'dashed', 'dotted'];
const CORNERS: readonly CanvasCorners[] = ['sharp', 'round'];
const FONT_FAMILIES: readonly CanvasFontFamily[] = ['sans', 'serif', 'mono'];
const FONT_SIZES: readonly CanvasFontSize[] = ['s', 'm', 'l', 'xl'];
const TEXT_ALIGNS: readonly CanvasTextAlign[] = ['left', 'center', 'right'];

const FONT_SIZE_PX: Record<CanvasFontSize, number> = { s: 12, m: 14, l: 18, xl: 24 };
const FONT_FAMILY_CSS: Record<CanvasFontFamily, string> = {
  sans: 'var(--q-font-family-ui)',
  serif: 'var(--q-font-family-heading)',
  mono: 'var(--q-font-family-mono)',
};

const pick = <T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? value as T : fallback;

const shapeOf = (node: CanvasNode): string | null => {
  const obsidium = isRecord(node.obsidium) ? node.obsidium : null;
  return obsidium && typeof obsidium.shape === 'string' ? obsidium.shape : null;
};

const normalizeFill = (value: unknown): string | null => {
  if (typeof value !== 'string' || value === '' || value === 'transparent') return null;
  return value;
};

export const canvasAppearanceDefaults = (node: CanvasNode): CanvasAppearance => {
  const shape = shapeOf(node);
  return {
    strokeWidth: 2,
    strokeStyle: 'solid',
    corners: 'round',
    fontFamily: 'sans',
    fontSize: 'm',
    textAlign: shape ? 'center' : 'left',
    opacity: 1,
    fill: shape === 'sticker' ? '3' : null,
  };
};

export const readCanvasAppearance = (node: CanvasNode): CanvasAppearance => {
  const defaults = canvasAppearanceDefaults(node);
  const obsidium = isRecord(node.obsidium) ? node.obsidium : {};
  const opacity = typeof obsidium.opacity === 'number' && Number.isFinite(obsidium.opacity)
    ? Math.min(1, Math.max(0, obsidium.opacity))
    : defaults.opacity;
  return {
    strokeWidth: pick(obsidium.strokeWidth, STROKE_WIDTHS, defaults.strokeWidth),
    strokeStyle: pick(obsidium.strokeStyle, STROKE_STYLES, defaults.strokeStyle),
    corners: pick(obsidium.corners, CORNERS, defaults.corners),
    fontFamily: pick(obsidium.fontFamily, FONT_FAMILIES, defaults.fontFamily),
    fontSize: pick(obsidium.fontSize, FONT_SIZES, defaults.fontSize),
    textAlign: pick(obsidium.textAlign, TEXT_ALIGNS, defaults.textAlign),
    opacity,
    fill: obsidium.fill === undefined ? defaults.fill : normalizeFill(obsidium.fill),
  };
};

const writeAppearanceValue = (
  target: Record<string, unknown>,
  key: keyof CanvasAppearance,
  value: CanvasAppearance[keyof CanvasAppearance],
  fallback: CanvasAppearance[keyof CanvasAppearance],
): void => {
  if (key === 'fill') {
    if (value === null) target.fill = 'transparent';
    else if (value === fallback) delete target.fill;
    else target.fill = value;
    return;
  }
  if (value === fallback) delete target[key];
  else target[key] = value;
};

export const withCanvasAppearance = <T extends CanvasNode>(node: T, patch: CanvasAppearancePatch): T => {
  const current = readCanvasAppearance(node);
  const defaults = canvasAppearanceDefaults(node);
  const next: CanvasAppearance = { ...current, ...patch };
  const obsidium = { ...(isRecord(node.obsidium) ? node.obsidium : {}) };
  for (const key of Object.keys(next) as (keyof CanvasAppearance)[]) {
    writeAppearanceValue(obsidium, key, next[key], defaults[key]);
  }
  return { ...node, obsidium };
};

export const canvasStrokeDasharray = (style: CanvasStrokeStyle, width: CanvasStrokeWidth, scale = 1): string | undefined => {
  if (style === 'dashed') return `${width * 4 * scale} ${width * 3 * scale}`;
  if (style === 'dotted') return `${width * scale} ${width * 2 * scale}`;
  return undefined;
};

export const canvasFontSizePixels = (size: CanvasFontSize): number => FONT_SIZE_PX[size];

export const canvasFontFamilyCss = (family: CanvasFontFamily): string => FONT_FAMILY_CSS[family];

export const canvasAppearanceStyle = (appearance: CanvasAppearance): Record<string, string> => {
  const style: Record<string, string> = {
    '--q-canvas-font-size': `${canvasFontSizePixels(appearance.fontSize)}px`,
    '--q-canvas-font-family': canvasFontFamilyCss(appearance.fontFamily),
    '--q-canvas-text-align': appearance.textAlign,
  };
  return style;
};
