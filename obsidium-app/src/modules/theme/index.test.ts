// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { motionEnabled, setTheme, themeMode, themePalettes } from './index';

const paletteStyles = readFileSync(resolve(process.cwd(), 'src/styles/themes/palettes.css'), 'utf8');
const semanticPaletteStyles = readFileSync(resolve(process.cwd(), 'src/styles/themes/palette-semantic.css'), 'utf8');
const motionStyles = readFileSync(resolve(process.cwd(), 'src/styles/themes/motion.css'), 'utf8');

function contrastRatio(first: string, second: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/[\da-f]{2}/giu)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
    const [red, green, blue] = channels.map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function paletteColors(id: string, mode: 'light' | 'dark'): Record<string, string> {
  const declarations = [...paletteStyles.matchAll(/(--q-palette-[\w-]+):\s*([^;]+);/gu)];
  const values = new Map(declarations.map(([, name, value]) => [name, value.trim()]));
  const resolveColor = (value: string | undefined) => {
    if (value && /^#[\da-f]{6}$/iu.test(value)) return value;
    throw new Error(`Non-static palette color ${id} ${mode}: ${value}`);
  };
  const colors = Object.fromEntries(['background', 'text', 'accent'].map((kind) => {
    return [kind, resolveColor(values.get(`--q-palette-${id}-${mode}-${kind}`))];
  }));
  return colors;
}

describe('theme engine', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    const paletteSheet = document.createElement('style');
    paletteSheet.textContent = paletteStyles;
    document.head.append(paletteSheet);
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

  it('keeps every palette token available for the settings previews', () => {
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

  it('keeps text and accent-button labels at WCAG AA across all palette modes', () => {
    expect(themePalettes).toHaveLength(58);
    let checked = 0;
    for (const { id } of themePalettes) {
      for (const mode of ['light', 'dark'] as const) {
        const { background, text: sourceText, accent } = paletteColors(id, mode);
        expect(contrastRatio(sourceText, background), `${id} ${mode} source text`).toBeGreaterThanOrEqual(4.5);
        setTheme(mode, id);
        expect(document.documentElement.style.getPropertyValue('--q-palette-current-background')).toBe(background);
        expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main')).toBe(accent);
        const text = document.documentElement.style.getPropertyValue('--q-text-primary');
        const link = document.documentElement.style.getPropertyValue('--q-text-accent');
        const linkHover = document.documentElement.style.getPropertyValue('--q-text-link-hover');
        const onAccent = document.documentElement.style.getPropertyValue('--q-text-on-accent');
        expect(contrastRatio(text, background), `${id} ${mode} body text`).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(link, background), `${id} ${mode} link text`).toBeGreaterThanOrEqual(4.5);
        expect(linkHover).toBe(link);
        expect(onAccent, `${id} ${mode} accent button text`).toMatch(/^#[\da-f]{6}$/iu);
        expect(contrastRatio(onAccent, accent), `${id} ${mode} accent button text`).toBeGreaterThanOrEqual(4.5);
        checked += 1;
      }
    }
    expect(checked).toBe(116);
  });

  it('binds component states to the active palette semantic tokens', () => {
    for (const token of [
      '--q-bg-surface-hover', '--q-bg-surface-active', '--q-border-focus-ring',
      '--q-sidebar-item-active-bg', '--q-tab-bg-active', '--q-editor-code-keyword',
      '--q-dialog-bg', '--q-graph-node', '--q-text-on-accent',
    ]) {
      expect(semanticPaletteStyles).toContain(token);
    }
    expect(semanticPaletteStyles).toContain(':root[data-palette][data-theme]');
    expect(semanticPaletteStyles).toContain('var(--q-bg-accent)');
    expect(semanticPaletteStyles).not.toMatch(/#[\da-f]{3,8}/iu);
  });

  it('falls back to Obsidium for an unknown palette id', () => {
    setTheme('light', 'missing-palette');
    expect(document.documentElement.dataset.palette).toBe('obsidium');
    expect(document.documentElement.style.getPropertyValue('--q-bg-canvas')).toBe('#ffffff');
  });

  it('applies appearance and palette immediately and preserves Obsidian root classes', () => {
    setTheme('light', 'dracula', 'off');
    expect(document.documentElement.dataset).toMatchObject({
      appearance: 'light', palette: 'dracula', motion: 'off', theme: 'light',
    });
    expect(document.documentElement.classList.contains('theme-light')).toBe(true);
    expect(document.documentElement.style.getPropertyValue('--q-editor-bg'))
      .toBe(paletteColors('dracula', 'light').background);
    expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main'))
      .toBe(paletteColors('dracula', 'light').accent);
  });

  it('applies the selected dark palette background to the editor canvas', () => {
    setTheme('dark', 'dracula', 'off');
    expect(document.documentElement.style.getPropertyValue('--q-editor-bg'))
      .toBe(paletteColors('dracula', 'dark').background);
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

  it('tracks system appearance changes and system reduced-motion preference', () => {
    const query = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.spyOn(window, 'matchMedia').mockImplementation((media) => ({
      ...query,
      matches: media.includes('color-scheme'),
    }) as unknown as MediaQueryList);
    setTheme('system', 'obsidium', 'system');
    expect(themeMode()).toBe('dark');
    expect(document.documentElement.dataset.motion).toBe('system');
  });

  it('keeps mode aliases synchronized after a palette change', () => {
    setTheme('dark', 'nord', 'on');
    expect(document.documentElement.classList.contains('theme-dark')).toBe(true);
    expect(document.documentElement.classList.contains('theme-light')).toBe(false);
    expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main'))
      .toBe(paletteColors('nord', 'dark').accent);
  });

  it('switches the selected palette independently between light and dark modes', () => {
    setTheme('dark', 'dracula');
    expect(document.documentElement.style.getPropertyValue('--q-bg-canvas'))
      .toBe(paletteColors('dracula', 'dark').background);
    setTheme('light', 'dracula');
    expect(document.documentElement.style.getPropertyValue('--q-bg-canvas'))
      .toBe(paletteColors('dracula', 'light').background);
    expect(document.documentElement.dataset.palette).toBe('dracula');
  });

  it('uses palette accent by default and only replaces it in custom mode', () => {
    setTheme('light', 'graphite');
    expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main'))
      .toBe(paletteColors('graphite', 'light').accent);

    setTheme('light', 'graphite', 'system', 'custom', '#ff00aa');
    expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main')).toBe('#ff00aa');
  });
});
