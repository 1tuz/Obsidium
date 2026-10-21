export const CANVAS_PRESET_COLORS: Record<string, string> = {
  '1': '--q-red-600',
  '2': '--q-amber-600',
  '3': '--q-yellow-alpha-main',
  '4': '--q-green-600',
  '5': '--q-teal-600',
  '6': '--q-purple-600',
};

export const canvasColorCss = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value === '') return undefined;
  if (/^[1-6]$/.test(value)) return `var(${CANVAS_PRESET_COLORS[value]})`;
  if (/^#[\da-f]{3,8}$/i.test(value)) return value;
  return undefined;
};

export const canvasFillCss = (value: unknown): string | undefined => {
  const color = canvasColorCss(value);
  return color ? `color-mix(in srgb, ${color} 18%, var(--q-canvas-paper))` : undefined;
};
