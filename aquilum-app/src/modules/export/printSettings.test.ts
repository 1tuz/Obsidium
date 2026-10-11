import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKDOWN_READING_SETTINGS } from '../settings';
import { printReadingProperties } from './printSettings';

describe('printReadingProperties', () => {
  it('preserves current print typography when settings are missing or use the theme', () => {
    expect(printReadingProperties()).toBeUndefined();
    expect(printReadingProperties(DEFAULT_MARKDOWN_READING_SETTINGS)).toBeUndefined();
  });

  it('maps book reading settings to PDF typography and page width', () => {
    expect(printReadingProperties({
      ...DEFAULT_MARKDOWN_READING_SETTINGS,
      style: 'dark-paper',
      font: 'book',
      fontSizePx: 20,
      lineHeight: 1.8,
      pageWidthCh: 72,
    })).toEqual({
      '--q-print-font-family': 'Georgia, "Times New Roman", serif',
      '--q-print-font-size': '20px',
      '--q-print-line-height': '1.8',
      '--q-print-page-width': '72ch',
    });
  });

  it('uses the configured editor font for standard reading', () => {
    expect(printReadingProperties({
      ...DEFAULT_MARKDOWN_READING_SETTINGS,
      style: 'ivory',
    })?.['--q-print-font-family']).toBe('var(--q-editor-font-family)');
  });
});
