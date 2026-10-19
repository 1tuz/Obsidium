export const PANEL_LIMITS = {
  left: { min: 180, max: 480, fallback: 224 },
  right: { min: 220, max: 560, fallback: 320 },
} as const;

export type PanelSide = keyof typeof PANEL_LIMITS;

export function clampPanelWidth(side: PanelSide, width: number): number {
  const { min, max, fallback } = PANEL_LIMITS[side];
  if (!Number.isFinite(width)) return fallback;
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function resizePanel(side: PanelSide, startWidth: number, deltaX: number): number {
  const direction = side === 'left' ? 1 : -1;
  return clampPanelWidth(side, startWidth + direction * deltaX);
}
