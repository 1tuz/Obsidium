import { describe, expect, it } from 'vitest';
import { parseThemePaletteImport } from './import';

function token(red: number, green: number, blue: number) {
  return { $type: 'color', $value: { colorSpace: 'srgb', components: [red, green, blue] } };
}

function source() {
  return JSON.stringify({
    light: { background: token(1, 1, 1), text: token(0, 0, 0), accent: token(0.25, 0.5, 1) },
    dark: { background: token(0, 0, 0), text: token(1, 1, 1), accent: token(1, 0.5, 0.25) },
  });
}

describe('DTCG palette import', () => {
  it('imports light and dark opaque sRGB colors and derives a stable id from the filename', () => {
    expect(parseThemePaletteImport(source(), 'Blue Sky.tokens.json')).toEqual({
      id: expect.stringMatching(/^custom-[\da-f]{8}$/u),
      name: 'Blue Sky',
      light: { background: '#ffffff', text: '#000000', accent: '#4080ff' },
      dark: { background: '#000000', text: '#ffffff', accent: '#ff8040' },
    });
  });

  it('supports Unicode filenames and keeps their ids stable across imports', () => {
    const first = parseThemePaletteImport(source(), 'Ночная тема.tokens');
    const second = parseThemePaletteImport(source(), 'Ночная тема.tokens');
    expect(first.name).toBe('Ночная тема');
    expect(first.id).toMatch(/^custom-[\da-f]{8}$/u);
    expect(second.id).toBe(first.id);
  });

  it.each([
    ['invalid JSON', '{'],
    ['missing light group', JSON.stringify({ dark: {} })],
    ['missing role', JSON.stringify({ light: { background: token(1, 1, 1) }, dark: {} })],
    ['unsupported color space', JSON.stringify({ light: { background: { $type: 'color', $value: { colorSpace: 'display-p3', components: [1, 1, 1] } } } })],
    ['component outside sRGB range', JSON.stringify({ light: { background: token(2, 0, 0) } })],
    ['alpha colors', JSON.stringify({ light: { background: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1], alpha: 0.5 } } } })],
  ])('rejects %s without producing a partial palette', (_label, contents) => {
    expect(() => parseThemePaletteImport(contents, 'Palette.json')).toThrow();
  });

  it('rejects files above the import size limit', () => {
    expect(() => parseThemePaletteImport(`${source()}${' '.repeat(65_536)}`, 'Palette.json')).toThrow('too large');
  });
});
