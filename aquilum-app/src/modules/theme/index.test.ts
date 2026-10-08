// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { motionEnabled, setTheme, themeMode, themePalettes } from './index';

const paletteStyles = readFileSync(resolve(process.cwd(), 'src/styles/themes/palettes.css'), 'utf8');
const motionStyles = readFileSync(resolve(process.cwd(), 'src/styles/themes/motion.css'), 'utf8');

describe('theme engine', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-appearance');
    document.documentElement.removeAttribute('data-palette');
    document.documentElement.removeAttribute('data-motion');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
  });

  it('registers every requested palette with both appearances', () => {
    expect(themePalettes.map(({ id }) => id).sort()).toEqual([
      'obsidium', 'obsidian', 'dracula', 'vscode', 'cursor', 'catppuccin',
      'nord', 'tokyo-night', 'gruvbox', 'rose-pine', 'one-dark',
      'everforest', 'kanagawa', 'flexoki', 'ayu', 'solarized', 'material',
      'github', 'nightfox', 'graphite', 'carbon', 'metal', 'iceberg',
      'notion', 'craft', 'bear', 'capacities', 'anytype', 'notesnook', 'heptabase', 'logseq',
      'reham-amber', 'reham-aubergine', 'reham-dawn', 'reham-dracula', 'reham-ember',
      'reham-forest', 'reham-graphite', 'reham-ink', 'reham-matcha', 'reham-mint',
      'reham-mist', 'reham-nord', 'reham-obsidian', 'reham-ocean', 'reham-peach',
      'reham-quantum', 'reham-ruby', 'reham-sakura', 'reham-solarized', 'reham-synth',
      'reham-teal', 'reham-violet', 'reham-void', 'blush-osyx', 'malachite-osyx',
      'sakura-osyx', 'cendre',
    ].sort());
    for (const palette of themePalettes) {
      expect(palette.light.accent).toContain(`${palette.id}-light-accent`);
      expect(palette.dark.accent).toContain(`${palette.id}-dark-accent`);
    }
    expect(themePalettes.map(({ name }) => name)).toEqual(
      [...themePalettes.map(({ name }) => name)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    );
  });

  it('keeps every palette token available to all preview cards', () => {
    const rootTokens = [...paletteStyles.matchAll(/:root\s*\{([^}]*)\}/gu)]
      .map((match) => match[1])
      .join('\n');
    for (const { id } of themePalettes) {
      expect(rootTokens).toContain(`--q-palette-${id}-light-background`);
      expect(rootTokens).toContain(`--q-palette-${id}-light-accent`);
      expect(rootTokens).toContain(`--q-palette-${id}-dark-background`);
      expect(rootTokens).toContain(`--q-palette-${id}-dark-accent`);
    }
  });

  it('applies appearance and palette immediately and preserves Obsidian root classes', () => {
    setTheme('light', 'dracula', 'off');
    expect(document.documentElement.dataset).toMatchObject({
      appearance: 'light', palette: 'dracula', motion: 'off', theme: 'light',
    });
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main')).toContain('dracula-light-accent');
  });

  it('disables CSS animation and transition when motion is off', () => {
    setTheme('light', 'obsidium', 'off');
    expect(motionEnabled()).toBe(false);
    expect(motionStyles).toContain('animation: none !important');
    expect(motionStyles).toContain('transition: none !important');
  });

  it('keeps motion disabled before saved settings load', () => {
    expect(motionEnabled()).toBe(false);
  });

  it('allows motion when the user turns it on', () => {
    setTheme('light', 'obsidium', 'on');
    expect(motionEnabled()).toBe(true);
  });

  it('tracks system appearance changes while motion remains binary', () => {
    const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
      ...query,
      matches: media.includes('color-scheme'),
    }) as unknown as MediaQueryList);
    setTheme('system', 'obsidium', 'on');
    expect(themeMode()).toBe('dark');
    expect(document.documentElement.dataset.motion).toBe('on');
  });

  it('keeps mode aliases synchronized after a palette change', () => {
    setTheme('dark', 'nord', 'on');
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main')).toContain('nord-dark-accent');
  });

  it('switches the selected palette independently between light and dark modes', () => {
    setTheme('dark', 'dracula');
    expect(document.documentElement.style.getPropertyValue('--q-bg-canvas')).toContain('dracula-dark-background');
    setTheme('light', 'dracula');
    expect(document.documentElement.style.getPropertyValue('--q-bg-canvas')).toContain('dracula-light-background');
    expect(document.documentElement.dataset.palette).toBe('dracula');
  });

  it('uses palette accent by default and only replaces it in custom mode', () => {
    setTheme('light', 'graphite');
    expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main'))
      .toContain('graphite-light-accent');

    setTheme('light', 'graphite', 'on', 'custom', '#ff00aa');
    expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main')).toBe('#ff00aa');
  });
});
