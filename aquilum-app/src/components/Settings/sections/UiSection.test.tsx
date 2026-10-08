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
    expect(motionRow?.textContent).not.toContain('Авто');
    expect(renderer!.container.textContent).not.toContain(t('settings.ui.primaryColor'));
  });

  it('renders selectable palette cards and highlights the current palette', () => {
    const config = {
      ui: {
        appearance: 'dark', palette: 'dracula', accentMode: 'palette', motion: 'system',
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

    const cards = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-theme-card')];
    expect(cards.length).toBeGreaterThan(31);
    expect(cards.find((card) => card.textContent?.includes('Dracula'))?.getAttribute('aria-pressed')).toBe('true');
    const cendre = cards.find((card) => card.textContent?.includes('Cendre'))!;
    expect(cendre.querySelector('.q-theme-card__preview')).not.toBeNull();
    act(() => cendre.click());
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      ui: expect.objectContaining({ palette: 'cendre' }),
    }));
  });
});
