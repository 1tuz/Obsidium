import { describe, expect, it } from 'vitest';
import { normalizeReadingTheme, paperColors, readingColors, readingThemeOptions } from './reading';

const luminance = (hex: string) => {
  const n = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((part) => part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4);
  return n[0] * 0.2126 + n[1] * 0.7152 + n[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe('paper reading presets', () => {
  it('offers five real palettes plus the inherited appearance', () => {
    expect(readingThemeOptions).toHaveLength(6);
    expect(readingColors('inherit', 'light')).toBeNull();
    expect(normalizeReadingTheme('random')).toBe('inherit');
  });
  it('keeps at least AA body text contrast in every mode', () => {
    for (const palette of Object.values(paperColors)) {
      for (const mode of ['light', 'dark'] as const) {
        expect(contrast(palette[mode].text, palette[mode].background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
