import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { filterThemePalettes } from './ThemePaletteDialog';

describe('Theme palette search', () => {
  it('finds paper palettes case-insensitively', () => {
    expect(filterThemePalettes('  pApEr ' ).map(({ name }) => name)).toEqual(['Dark Paper', 'Paper White']);
    expect(filterThemePalettes('sePIa').map(({ id }) => id)).toEqual(['sepia']);
  });
  it('keeps alphabetical order and shows all themes when cleared', () => {
    const all = filterThemePalettes('');
    expect(all.length).toBeGreaterThan(60);
    expect(all.map(({ name }) => name)).toEqual(
      [...all.map(({ name }) => name)].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })),
    );
    expect(filterThemePalettes('no-such-palette')).toEqual([]);
  });

  it('keeps filtered palette cards at their natural height', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/components/Settings/sections/UiSection.css'), 'utf8');
    expect(styles).toMatch(/\.q-theme-gallery\s*\{[^}]*align-content:\s*start;/s);
  });
});
