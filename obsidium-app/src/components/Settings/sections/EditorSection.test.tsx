// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../modules/settings';
import { t } from '../../../i18n';
import { mountDom, type MountedDom } from '../../../testing/mountDom';
import { EditorSection } from './EditorSection';

describe('EditorSection Markdown reading settings', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('offers the autosave intervals in seconds and persists the choice', () => {
    const config = {
      editor: {
        fontFamily: 'iA Writer Mono', fontWeight: 400, fontSizeBase: 16,
        saveDebounceMs: 30000, lineHeight: 1.8, maxWidthCh: 65,
        smartDashes: true, listCallouts: true, autoLinkTitle: true,
        linkSuggest: true, linkSuggestMinChars: 2, liveTabs: 3,
        markdownReading: {
          style: 'theme', texture: 'off', font: 'standard',
          fontSizePx: 18, lineHeight: 1.7, pageWidthCh: 65,
        },
      },
    } as AppConfig;
    const onChange = vi.fn();
    act(() => { renderer = mountDom(<EditorSection config={config} onChange={onChange} />); });

    const buttons = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')];
    const minute = buttons.find((button) => button.textContent === t('settings.editor.saveSeconds', { count: 60 }));
    expect(minute).toBeDefined();
    act(() => minute!.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      editor: expect.objectContaining({ saveDebounceMs: 60000 }),
    }));
  });

  it('shows all paper previews and persists the selected style with existing editor settings', () => {
    const config = {
      editor: {
        fontFamily: 'iA Writer Mono', fontWeight: 400, fontSizeBase: 16,
        saveDebounceMs: 1000, lineHeight: 1.8, maxWidthCh: 65,
        smartDashes: true, listCallouts: true, autoLinkTitle: true,
        linkSuggest: true, linkSuggestMinChars: 2, liveTabs: 3,
        markdownReading: {
          style: 'theme', texture: 'off', font: 'standard',
          fontSizePx: 18, lineHeight: 1.7, pageWidthCh: 65,
        },
      },
    } as AppConfig;
    const onChange = vi.fn();
    act(() => { renderer = mountDom(<EditorSection config={config} onChange={onChange} />); });

    const styles = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-markdown-reading-style')];
    expect(styles).toHaveLength(6);
    expect(styles.every((button) => button.querySelector('.q-markdown-reading-style__page'))).toBe(true);
    expect(styles.find((button) => button.dataset.style === 'theme')?.getAttribute('aria-pressed')).toBe('true');
    act(() => styles.find((button) => button.dataset.style === 'sepia')?.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      editor: expect.objectContaining({
        fontSizeBase: 16,
        markdownReading: expect.objectContaining({ style: 'sepia' }),
      }),
    }));
  });

  it('exposes localized texture and font controls', () => {
    const config = {
      editor: {
        fontFamily: 'iA Writer Mono', fontWeight: 400, fontSizeBase: 16,
        saveDebounceMs: 1000, lineHeight: 1.8, maxWidthCh: 65,
        smartDashes: true, listCallouts: true, autoLinkTitle: true,
        linkSuggest: true, linkSuggestMinChars: 2, liveTabs: 3,
        markdownReading: {
          style: 'theme', texture: 'off', font: 'standard',
          fontSizePx: 18, lineHeight: 1.7, pageWidthCh: 65,
        },
      },
    } as AppConfig;
    act(() => { renderer = mountDom(<EditorSection config={config} onChange={vi.fn()} />); });

    expect(renderer!.container.textContent).toContain(t('settings.editor.textureSubtle'));
    expect(renderer!.container.textContent).toContain(t('settings.editor.fontBook'));
    expect(renderer!.container.textContent).toContain(t('settings.editor.readingPageWidth'));
  });
});
