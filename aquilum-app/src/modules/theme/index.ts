export type Theme = 'light' | 'dark' | 'system';
export type ThemeMode = 'light' | 'dark';
export type Motion = 'system' | 'on' | 'off';
export type AccentMode = 'palette' | 'custom';

export interface ThemeTokens {
  background: string;
  surface: string;
  raised: string;
  text: string;
  secondaryText: string;
  border: string;
  accent: string;
}

export interface ThemePalette {
  id: string;
  name: string;
  light: ThemeTokens;
  dark: ThemeTokens;
}

export function motionEnabled(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const motion = document.documentElement.dataset.motion;
  return motion === 'on' || (motion === 'system'
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function palette(id: string, name: string): ThemePalette {
  const tokens = (mode: ThemeMode): ThemeTokens => ({
    background: `var(--q-palette-${id}-${mode}-background)`,
    surface: `color-mix(in srgb, var(--q-palette-${id}-${mode}-background) 98%, var(--q-palette-${id}-${mode}-text))`,
    raised: `color-mix(in srgb, var(--q-palette-${id}-${mode}-background) 94%, var(--q-palette-${id}-${mode}-text))`,
    text: `var(--q-palette-${id}-${mode}-text)`,
    secondaryText: `color-mix(in srgb, var(--q-palette-${id}-${mode}-text) 68%, transparent)`,
    border: `color-mix(in srgb, var(--q-palette-${id}-${mode}-text) 14%, transparent)`,
    accent: `var(--q-palette-${id}-${mode}-accent)`,
  });
  return {
    id,
    name,
    light: tokens('light'),
    dark: tokens('dark'),
  };
}

export const themePalettes: ThemePalette[] = [
  palette('obsidium', 'Obsidium'),
  palette('obsidian', 'Obsidian'),
  palette('dracula', 'Dracula'),
  palette('vscode', 'VS Code'),
  palette('cursor', 'Cursor'),
  palette('catppuccin', 'Catppuccin'),
  palette('nord', 'Nord'),
  palette('tokyo-night', 'Tokyo Night'),
  palette('gruvbox', 'Gruvbox'),
  palette('rose-pine', 'Rose Pine'),
  palette('one-dark', 'One Dark'),
  palette('everforest', 'Everforest'),
  palette('kanagawa', 'Kanagawa'),
  palette('flexoki', 'Flexoki'),
  palette('ayu', 'Ayu'),
  palette('solarized', 'Solarized'),
  palette('material', 'Material'),
  palette('github', 'GitHub'),
  palette('nightfox', 'Nightfox'),
  palette('graphite', 'Graphite'),
  palette('carbon', 'Carbon'),
  palette('metal', 'Metal'),
  palette('iceberg', 'Iceberg'),
  palette('notion', 'Notion'),
  palette('craft', 'Craft'),
  palette('bear', 'Bear'),
  palette('capacities', 'Capacities'),
  palette('anytype', 'Anytype'),
  palette('notesnook', 'Notesnook'),
  palette('heptabase', 'Heptabase'),
  palette('logseq', 'Logseq'),
  palette("reham-amber", "Amber (RehamVim)"),
  palette("reham-aubergine", "Aubergine (RehamVim)"),
  palette("reham-dawn", "Dawn (RehamVim)"),
  palette("reham-dracula", "Dracula (RehamVim)"),
  palette("reham-ember", "Ember (RehamVim)"),
  palette("reham-forest", "Forest (RehamVim)"),
  palette("reham-graphite", "Graphite (RehamVim)"),
  palette("reham-ink", "Ink (RehamVim)"),
  palette("reham-matcha", "Matcha (RehamVim)"),
  palette("reham-mint", "Mint (RehamVim)"),
  palette("reham-mist", "Mist (RehamVim)"),
  palette("reham-nord", "Nord (RehamVim)"),
  palette("reham-obsidian", "Obsidian (RehamVim)"),
  palette("reham-ocean", "Ocean (RehamVim)"),
  palette("reham-peach", "Peach (RehamVim)"),
  palette("reham-quantum", "Quantum (RehamVim)"),
  palette("reham-ruby", "Ruby (RehamVim)"),
  palette("reham-sakura", "Sakura (RehamVim)"),
  palette("reham-solarized", "Solarized (RehamVim)"),
  palette("reham-synth", "Synth (RehamVim)"),
  palette("reham-teal", "Teal (RehamVim)"),
  palette("reham-violet", "Violet (RehamVim)"),
  palette("reham-void", "Void (RehamVim)"),
  palette('blush-osyx', 'Blush (osyx)'),
  palette('malachite-osyx', 'Malachite (osyx)'),
  palette('sakura-osyx', 'Sakura (osyx)'),
  palette('cendre', 'Cendre'),
].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

let currentAppearance: Theme = 'system';
let currentMode: ThemeMode = 'light';
let currentPalette = 'obsidium';
let currentMotion: Motion = 'off';
let currentAccentMode: AccentMode = 'palette';
let currentPrimaryColor = '#1471eb';
const modeListeners = new Set<() => void>();

function resolveAppearance(appearance: Theme): ThemeMode {
  return appearance === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : appearance;
}

function hexChannels(color: string): [number, number, number] | null {
  const match = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu);
  return match
    ? [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16), Number.parseInt(match[3], 16)]
    : null;
}

function relativeLuminance(color: string): number {
  const channels = hexChannels(color);
  if (!channels) return 0;
  const [red, green, blue] = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const values = [relativeLuminance(first), relativeLuminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function mixHex(first: string, second: string, ratio: number): string {
  const firstChannels = hexChannels(first);
  const secondChannels = hexChannels(second);
  if (!firstChannels || !secondChannels) return first;
  return `#${firstChannels.map((channel, index) => (
    Math.round(channel * (1 - ratio) + secondChannels[index] * ratio).toString(16).padStart(2, '0')
  )).join('')}`;
}

function accessibleForeground(foreground: string, background: string): string {
  if (contrastRatio(foreground, background) >= 4.5) return foreground;
  const target = contrastRatio('#000000', background) > contrastRatio('#ffffff', background)
    ? '#000000'
    : '#ffffff';
  let low = 0;
  let high = 1;
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const middle = (low + high) / 2;
    if (contrastRatio(mixHex(foreground, target, middle), background) >= 4.5) high = middle;
    else low = middle;
  }
  return mixHex(foreground, target, high);
}

function paletteColor(root: HTMLElement, id: string, mode: ThemeMode, role: string): string {
  return getComputedStyle(root).getPropertyValue(`--q-palette-${id}-${mode}-${role}`).trim();
}

function applyTheme(
  appearance: Theme,
  paletteId: string,
  motion: Motion,
  accentMode: AccentMode,
  primaryColor: string,
): void {
  const root = document.documentElement;
  const mode = resolveAppearance(appearance);
  const selected = themePalettes.find(({ id }) => id === paletteId)
    ?? themePalettes.find(({ id }) => id === 'obsidium')!;
  const background = paletteColor(root, selected.id, mode, 'background');
  const paletteText = paletteColor(root, selected.id, mode, 'text');
  const paletteAccent = paletteColor(root, selected.id, mode, 'accent');
  const readableText = accessibleForeground(paletteText, background);
  const accent = accentMode === 'custom' ? primaryColor : paletteAccent;
  const readableAccent = accessibleForeground(accent, background);
  const onAccent = contrastRatio('#000000', accent) >= contrastRatio('#ffffff', accent)
    ? '#000000'
    : '#ffffff';
  root.dataset.appearance = mode;
  root.dataset.theme = mode;
  root.dataset.palette = selected.id;
  root.dataset.motion = motion;
  root.classList.toggle('theme-light', mode === 'light');
  root.classList.toggle('theme-dark', mode === 'dark');
  root.style.setProperty('--q-palette-current-background', background);
  root.style.setProperty('--q-palette-current-text', readableText);
  root.style.setProperty('--q-palette-current-text-accent', readableAccent);
  root.style.setProperty('--q-palette-current-text-on-accent', onAccent);
  root.style.setProperty('--q-bg-canvas', background);
  root.style.setProperty('--q-text-primary', readableText);
  root.style.setProperty('--q-text-secondary', readableText);
  root.style.setProperty('--q-text-muted', readableText);
  root.style.setProperty('--q-text-tertiary', readableText);
  root.style.setProperty('--q-text-disabled', readableText);
  root.style.setProperty('--q-text-accent', readableAccent);
  root.style.setProperty('--q-text-link-hover', readableAccent);
  root.style.setProperty('--q-text-on-accent', onAccent);
  root.dataset.accentMode = accentMode;
  root.style.setProperty('--q-blue-alpha-main', accent);
  root.style.setProperty('--q-blue-500', accent);
  root.style.setProperty('--q-blue-600', readableAccent);
  root.style.setProperty('--background-primary', 'var(--q-bg-canvas)');
  root.style.setProperty('--background-secondary', 'var(--q-bg-surface)');
  root.style.setProperty('--background-modifier-hover', 'var(--q-bg-surface-hover)');
  root.style.setProperty('--background-modifier-border', 'var(--q-border-default)');
  root.style.setProperty('--text-normal', 'var(--q-text-primary)');
  root.style.setProperty('--text-muted', 'var(--q-text-tertiary)');
  root.style.setProperty('--text-accent', 'var(--q-text-accent)');
  root.style.setProperty('--interactive-accent', 'var(--q-blue-alpha-main)');
  root.style.setProperty('--interactive-accent-hover', 'var(--q-blue-600)');
  if (mode !== currentMode) {
    currentMode = mode;
    modeListeners.forEach((notify) => notify());
  }
  root.dispatchEvent(new CustomEvent('aquilum-motion-change', { detail: motion }));
}

export function themeMode(): ThemeMode {
  return currentMode;
}

export function subscribeThemeMode(listener: () => void): () => void {
  modeListeners.add(listener);
  return () => modeListeners.delete(listener);
}

export function setTheme(
  appearance: Theme,
  paletteId = 'obsidium',
  motion: Motion = 'off',
  accentMode: AccentMode = 'palette',
  primaryColor = '#1471eb',
): void {
  currentAppearance = appearance;
  currentPalette = paletteId;
  currentMotion = motion;
  currentAccentMode = accentMode;
  currentPrimaryColor = primaryColor;
  applyTheme(appearance, paletteId, motion, accentMode, primaryColor);
}

export function initTheme(): () => void {
  applyTheme(currentAppearance, currentPalette, currentMotion, currentAccentMode, currentPrimaryColor);
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (currentAppearance === 'system') {
      const root = document.documentElement;
      applyTheme('system', root.dataset.palette ?? 'obsidium', (root.dataset.motion as Motion) ?? currentMotion,
        (root.dataset.accentMode as AccentMode) ?? 'palette', currentPrimaryColor);
    }
  };
  colorScheme.addEventListener('change', handleChange);
  return () => colorScheme.removeEventListener('change', handleChange);
}
