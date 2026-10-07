// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { setTheme } from '../../modules/theme';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { Titlebar } from './Titlebar';

describe('Titlebar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('shows and invokes the quick theme switch in the real titlebar', () => {
    const onToggleTheme = vi.fn();
    setTheme('dark', 'obsidium');

    act(() => {
      renderer = mountDom(<Titlebar onToggleTheme={onToggleTheme} />);
    });

    const button = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('titlebar.switchToLightTheme')}"]`,
    );
    expect(button).not.toBeNull();

    act(() => button!.click());

    expect(onToggleTheme).toHaveBeenCalledOnce();
  });
});
