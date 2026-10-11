import { describe, expect, it } from 'vitest';
import { normalizeConfig, type AppConfig } from './index';

describe('normalizeConfig', () => {
  it('fills Markdown reading defaults for existing settings and preserves stored values', () => {
    const config = {
      builtins: {},
      ui: { fontFamily: 'Inter', fontWeight: 400 },
      editor: {
        fontFamily: 'iA Writer Mono', fontWeight: 400, fontSizeBase: 16,
        markdownReading: { style: 'sepia', pageWidthCh: 74 },
      },
      reader: { fontFamily: 'iA Writer Quattro', fontWeight: 400 },
    } as unknown as AppConfig;

    const normalized = normalizeConfig(config);

    expect(normalized.editor.markdownReading).toEqual({
      style: 'sepia', texture: 'off', font: 'standard',
      fontSizePx: 18, lineHeight: 1.7, pageWidthCh: 74,
    });
    expect(normalized.editor.fontSizeBase).toBe(16);
  });
});
