// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../modules/settings';
import { t } from '../../../i18n';
import { mountDom, type MountedDom } from '../../../testing/mountDom';
import { UiSection } from './UiSection';

describe('UiSection', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('shows a binary animation control without an automatic mode', () => {
    const config = {
      ui: {
        appearance: 'system',
        palette: 'obsidium',
        accentMode: 'palette',
        motion: 'on',
        enabledSnippets: {},
        language: 'ru',
        primaryColor: '#D357FE',
        fontFamily: 'Inter',
        fontWeight: 400,
        fontSizeBase: 14,
      },
    } as unknown as AppConfig;

    act(() => {
      renderer = mountDom(
        <UiSection
          config={config}
          onChange={vi.fn()}
          workspacePath={null}
          homePage=""
          onHomePageChange={vi.fn()}
        />,
      );
    });

    const motionRow = [...renderer!.container.querySelectorAll('.q-settings-row')]
      .find((row) => row.textContent?.includes(t('settings.ui.animations')));
    expect(motionRow?.textContent).toContain(t('theme.on'));
    expect(motionRow?.textContent).toContain(t('theme.off'));
    expect(motionRow?.textContent).toContain(t('settings.ui.motionHint'));
    expect(motionRow?.textContent).not.toContain('Авто');
    expect(renderer!.container.textContent).not.toContain(t('settings.ui.primaryColor'));
  });

  it('offers the three icon sets with live previews and saves the selected set', () => {
    const config = {
      ui: {
        appearance: 'dark', palette: 'obsidium', accentMode: 'palette', motion: 'off', iconSet: 'lucide',
        enabledSnippets: {}, language: 'ru', primaryColor: '#1471eb',
        fontFamily: 'Inter', fontWeight: 400, fontSizeBase: 14,
      },
    } as unknown as AppConfig;
    const onChange = vi.fn();

    act(() => {
      renderer = mountDom(
        <UiSection config={config} onChange={onChange} workspacePath={null} homePage="" onHomePageChange={vi.fn()} />,
      );
    });

    const buttons = [...renderer!.container.querySelectorAll<HTMLButtonElement>('[data-icon-set-choice]')];
    expect(buttons.map((button) => button.dataset.iconSetChoice)).toEqual(['lucide', 'tabler', 'phosphor']);
    expect(buttons.every((button) => button.querySelector('svg'))).toBe(true);
    act(() => buttons[2]?.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ui: expect.objectContaining({ iconSet: 'phosphor' }) }));
  });

  it('shows and saves the Ardoise palette in the palette chooser', () => {
    const config = {
      ui: {
        appearance: 'dark', palette: 'dracula', accentMode: 'palette', motion: 'off',
        enabledSnippets: {}, language: 'ru', primaryColor: '#D357FE',
        fontFamily: 'Inter', fontWeight: 400, fontSizeBase: 14,
      },
    } as unknown as AppConfig;
    const onChange = vi.fn();

    act(() => {
      renderer = mountDom(
        <UiSection config={config} onChange={onChange} workspacePath={null} homePage="" onHomePageChange={vi.fn()} />,
      );
    });

    expect(renderer!.container.querySelector('.q-theme-card')).toBeNull();
    act(() => renderer!.container.querySelector<HTMLButtonElement>('[data-testid="open-palette-chooser"]')?.click());
    expect(renderer!.container.querySelector('.q-theme-palette-dialog')).not.toBeNull();
    const cards = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-theme-card')];
    expect(cards.length).toBeGreaterThan(31);
    expect(cards.find((card) => card.textContent?.includes('Dracula'))?.getAttribute('aria-pressed')).toBe('true');
    const ardoise = cards.find((card) => card.textContent?.includes('Ardoise'))!;
    expect(ardoise.querySelector('.q-theme-card__preview')).not.toBeNull();
    act(() => ardoise.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      ui: expect.objectContaining({ palette: 'ardoise' }),
    }));
    expect(renderer!.container.querySelector('.q-theme-palette-dialog')).toBeNull();
  });

  it('imports and replaces a same-name palette while selecting it for use', async () => {
    const config = {
      ui: {
        appearance: 'dark', palette: 'obsidium', accentMode: 'palette', motion: 'off', iconSet: 'lucide',
        enabledSnippets: {}, language: 'ru', primaryColor: '#1471eb', customPalettes: [],
        fontFamily: 'Inter', fontWeight: 400, fontSizeBase: 14,
      },
    } as unknown as AppConfig;
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(<UiSection config={config} onChange={onChange} workspacePath={null} homePage="" onHomePageChange={vi.fn()} />);
    });
    const contents = JSON.stringify({
      light: {
        background: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1] } },
        text: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0] } },
        accent: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0.5, 1] } },
      },
      dark: {
        background: { $type: 'color', $value: { colorSpace: 'srgb', components: [0, 0, 0] } },
        text: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 1, 1] } },
        accent: { $type: 'color', $value: { colorSpace: 'srgb', components: [1, 0.5, 0] } },
      },
    });
    const input = renderer!.container.querySelector<HTMLInputElement>('[data-testid="palette-import-file"]')!;
    for (let index = 0; index < 2; index += 1) {
      const file = new File([contents], 'Ночная тема.tokens');
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    const imported = onChange.mock.lastCall?.[0] as AppConfig;
    expect(imported.ui.palette).toMatch(/^custom-[\da-f]{8}$/u);
    expect(imported.ui.customPalettes).toHaveLength(1);
    expect(imported.ui.customPalettes[0].name).toBe('Ночная тема');
    expect(imported.ui.customPalettes[0].dark.accent).toBe('#ff8000');
    expect(renderer!.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows an error and skips reading an oversized palette file', async () => {
    const config = {
      ui: {
        appearance: 'dark', palette: 'obsidium', accentMode: 'palette', motion: 'off', iconSet: 'lucide',
        enabledSnippets: {}, language: 'ru', primaryColor: '#1471eb', customPalettes: [],
        fontFamily: 'Inter', fontWeight: 400, fontSizeBase: 14,
      },
    } as unknown as AppConfig;
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(<UiSection config={config} onChange={onChange} workspacePath={null} homePage="" onHomePageChange={vi.fn()} />);
    });
    const input = renderer!.container.querySelector<HTMLInputElement>('[data-testid="palette-import-file"]')!;
    const oversized = new File(['x'.repeat(65_537)], 'Large.json');
    const read = vi.spyOn(oversized, 'text');
    Object.defineProperty(input, 'files', { configurable: true, value: [oversized] });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(read).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(renderer!.container.querySelector('[role="alert"]')?.textContent).toBe(t('settings.ui.paletteImportError'));
  });
});
