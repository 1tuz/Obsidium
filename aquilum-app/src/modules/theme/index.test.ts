// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTheme, themeMode, themePalettes } from './index';

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
    expect(themePalettes.map(({ id }) => id)).toEqual([
      'obsidium', 'obsidian', 'dracula', 'vscode', 'cursor', 'catppuccin',
      'nord', 'tokyo-night', 'gruvbox', 'rose-pine', 'one-dark',
    ]);
    for (const palette of themePalettes) {
      expect(palette.light.accent).toContain(`${palette.id}-light-accent`);
      expect(palette.dark.accent).toContain(`${palette.id}-dark-accent`);
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
    expect(document.documentElement.style.getPropertyValue('--q-blue-alpha-main')).toContain('nord-dark-accent');
  });
});
