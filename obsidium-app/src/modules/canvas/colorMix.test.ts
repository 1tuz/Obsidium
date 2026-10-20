import { describe, expect, it } from 'vitest';
import { mixCssColors, parseCssColor } from './colorMix';

describe('parseCssColor', () => {
  it('reads hex, rgb and color(srgb) values', () => {
    expect(parseCssColor('#ffffff')).toEqual([255, 255, 255]);
    expect(parseCssColor('#000')).toEqual([0, 0, 0]);
    expect(parseCssColor('rgb(41 40 36)')).toEqual([41, 40, 36]);
    expect(parseCssColor('rgba(41, 40, 36, 0.5)')).toEqual([41, 40, 36]);
    expect(parseCssColor('color(srgb 0.5 0.25 0)')).toEqual([128, 64, 0]);
  });

  it('rejects values it cannot interpret', () => {
    expect(parseCssColor('currentColor')).toBeNull();
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('color-mix(in srgb, #fff 20%, #000)')).toBeNull();
  });
});

describe('mixCssColors', () => {
  it('mixes resolved colours, including the color(srgb) form browsers compute', () => {
    expect(mixCssColors('#ffffff', '#000000', 0.2)).toBe('rgb(204 204 204)');
    expect(mixCssColors('color(srgb 1 1 1)', 'rgb(0 0 0)', 0.25)).toBe('rgb(191 191 191)');
  });

  it('clamps the ratio and returns the source for unparsable input', () => {
    expect(mixCssColors('#ffffff', '#000000', 4)).toBe('rgb(0 0 0)');
    expect(mixCssColors('#ffffff', '#000000', -1)).toBe('rgb(255 255 255)');
    expect(mixCssColors('color-mix(in srgb, #fff 20%, #000)', '#000000', 0.5))
      .toBe('color-mix(in srgb, #fff 20%, #000)');
  });
});
