import { describe, expect, it } from 'vitest';
import { normalizeConfig, type AppConfig } from './index';

describe('normalizeConfig', () => {
  it('defaults old icon settings to Lucide and keeps a valid selected set', () => {
    const config = {
      builtins: {},
      ui: { fontFamily: 'Inter', fontWeight: 400, iconSet: 'unknown' },
      editor: { fontFamily: 'iA Writer Mono', fontWeight: 400 },
      reader: { fontFamily: 'iA Writer Quattro', fontWeight: 400 },
    } as unknown as AppConfig;

    expect(normalizeConfig(config).ui.iconSet).toBe('lucide');
    expect(normalizeConfig({ ...config, ui: { ...config.ui, iconSet: 'tabler' } }).ui.iconSet).toBe('tabler');
  });

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
      fontSizePx: 18, lineHeight: 1.7, pageWidthCh: 74, blockHover: true,
    });
    expect(normalized.editor.fontSizeBase).toBe(16);
  });

  it('widens the legacy 65-character page to the new default once', () => {
    const config = {
      builtins: {},
      ui: { fontFamily: 'Inter', fontWeight: 400 },
      editor: {
        fontFamily: 'iA Writer Mono', fontWeight: 400, maxWidthCh: 65,
        markdownReading: { pageWidthCh: 65 },
      },
      reader: { fontFamily: 'iA Writer Quattro', fontWeight: 400 },
    } as unknown as AppConfig;

    const normalized = normalizeConfig(config);
    expect(normalized.editor.maxWidthCh).toBe(100);
    expect(normalized.editor.markdownReading.pageWidthCh).toBe(100);
  });

  it('keeps a deliberate width and the full-width flag', () => {
    const config = {
      builtins: {},
      ui: { fontFamily: 'Inter', fontWeight: 400 },
      editor: {
        fontFamily: 'iA Writer Mono', fontWeight: 400, maxWidthCh: 140, fullWidth: true,
        markdownReading: { pageWidthCh: 120 },
      },
      reader: { fontFamily: 'iA Writer Quattro', fontWeight: 400 },
    } as unknown as AppConfig;

    const normalized = normalizeConfig(config);
    expect(normalized.editor.maxWidthCh).toBe(140);
    expect(normalized.editor.markdownReading.pageWidthCh).toBe(120);
    expect(normalized.editor.fullWidth).toBe(true);
  });

  it('defaults the minimap scale and clamps out-of-range values', () => {
    const config = {
      builtins: {},
      ui: { fontFamily: 'Inter', fontWeight: 400 },
      editor: { fontFamily: 'iA Writer Mono', fontWeight: 400 },
      reader: { fontFamily: 'iA Writer Quattro', fontWeight: 400 },
    } as unknown as AppConfig;

    expect(normalizeConfig(config).editor.headingMinimapScale).toBe(100);
    expect(normalizeConfig({ ...config, editor: { ...config.editor, headingMinimapScale: 999 } }).editor.headingMinimapScale).toBe(300);
    expect(normalizeConfig({ ...config, editor: { ...config.editor, headingMinimapScale: 1 } }).editor.headingMinimapScale).toBe(50);
    expect(normalizeConfig({ ...config, editor: { ...config.editor, headingMinimapScale: 137.7 } }).editor.headingMinimapScale).toBe(138);
  });
});
