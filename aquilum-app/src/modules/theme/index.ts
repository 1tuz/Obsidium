export type Theme = 'light' | 'dark' | 'system';
export type ThemeMode = 'light' | 'dark';
export type Motion = 'system' | 'on' | 'off';

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
  if (typeof document === 'undefined' || typeof window === 'undefined') return true;
  const motion = document.documentElement.dataset.motion;
  return motion === 'on' || (motion !== 'off'
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
];

let currentAppearance: Theme = 'system';
let currentMode: ThemeMode = 'light';
const modeListeners = new Set<() => void>();

function resolveAppearance(appearance: Theme): ThemeMode {
  return appearance === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : appearance;
}

function applyTheme(appearance: Theme, paletteId: string, motion: Motion): void {
  const root = document.documentElement;
  const mode = resolveAppearance(appearance);
  const selected = themePalettes.find(({ id }) => id === paletteId) ?? themePalettes[0];
  const tokens = selected[mode];
  root.dataset.appearance = mode;
  root.dataset.theme = mode;
  root.dataset.palette = selected.id;
  root.dataset.motion = motion;
  root.classList.toggle('theme-light', mode === 'light');
  root.classList.toggle('theme-dark', mode === 'dark');
  root.style.setProperty('--q-bg-canvas', tokens.background);
  root.style.setProperty('--q-bg-surface', tokens.surface);
  root.style.setProperty('--q-bg-surface-raised', tokens.raised);
  root.style.setProperty('--q-text-primary', tokens.text);
  root.style.setProperty('--q-text-secondary', tokens.secondaryText);
  root.style.setProperty('--q-border-solid', tokens.border);
  root.style.setProperty('--q-blue-alpha-main', tokens.accent);
  root.style.setProperty('--q-blue-500', tokens.accent);
  root.style.setProperty('--q-blue-600', tokens.accent);
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

export function setTheme(appearance: Theme, paletteId = 'obsidium', motion: Motion = 'system'): void {
  currentAppearance = appearance;
  applyTheme(appearance, paletteId, motion);
}

export function initTheme(): () => void {
  applyTheme(currentAppearance, 'obsidium', 'system');
  const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
  const handleChange = () => {
    if (currentAppearance === 'system') {
      const root = document.documentElement;
      applyTheme('system', root.dataset.palette ?? 'obsidium', (root.dataset.motion as Motion) ?? 'system');
    }
  };
  colorScheme.addEventListener('change', handleChange);
  return () => colorScheme.removeEventListener('change', handleChange);
}
