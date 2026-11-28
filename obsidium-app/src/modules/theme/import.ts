import type { ThemeMode, ThemeTokens } from './index';

export interface CustomThemePalette {
  id: string;
  name: string;
  light: { background: string; text: string; accent: string };
  dark: { background: string; text: string; accent: string };
}

const COLOR_ROLES = ['background', 'text', 'accent'] as const;
const MAX_PALETTE_BYTES = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseColorToken(value: unknown, path: string): string {
  if (!isRecord(value) || value.$type !== 'color' || !isRecord(value.$value)) {
    throw new Error(`${path} must be a DTCG color token`);
  }
  const color = value.$value;
  const components = color.components;
  if (color.colorSpace !== 'srgb' || !Array.isArray(components) || components.length !== 3
    || components.some((component) => typeof component !== 'number' || !Number.isFinite(component) || component < 0 || component > 1)
    || (color.alpha !== undefined && (typeof color.alpha !== 'number' || color.alpha !== 1))) {
    throw new Error(`${path} must use opaque sRGB components between 0 and 1`);
  }
  return `#${components.map((component) => Math.round((component as number) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function parseMode(root: Record<string, unknown>, mode: ThemeMode) {
  const group = root[mode];
  if (!isRecord(group)) throw new Error(`Missing ${mode} token group`);
  return Object.fromEntries(COLOR_ROLES.map((role) => [role, parseColorToken(group[role], `${mode}.${role}`)])) as CustomThemePalette[ThemeMode];
}

export function parseThemePaletteImport(contents: string, fileName: string): CustomThemePalette {
  if (new TextEncoder().encode(contents).byteLength > MAX_PALETTE_BYTES) {
    throw new Error('Palette file is too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('Palette file must contain valid JSON');
  }
  if (!isRecord(parsed)) throw new Error('Palette file must contain a JSON object');
  const name = fileName.replace(/\.tokens(?:\.json)?$|\.json$/iu, '').trim().slice(0, 48);
  if (!name) throw new Error('Palette file name is empty');
  const normalizedName = name.normalize('NFKC').toLowerCase();
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(normalizedName)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return {
    id: `custom-${hash.toString(16).padStart(8, '0')}`,
    name,
    light: parseMode(parsed, 'light'),
    dark: parseMode(parsed, 'dark'),
  };
}

export function customPaletteTokens(palette: CustomThemePalette, mode: ThemeMode): ThemeTokens {
  const colors = palette[mode];
  return {
    background: colors.background,
    text: colors.text,
    accent: colors.accent,
    surface: `color-mix(in srgb, ${colors.background} 98%, ${colors.text})`,
    raised: `color-mix(in srgb, ${colors.background} 94%, ${colors.text})`,
    secondaryText: `color-mix(in srgb, ${colors.text} 68%, transparent)`,
    border: `color-mix(in srgb, ${colors.text} 14%, transparent)`,
  };
}
