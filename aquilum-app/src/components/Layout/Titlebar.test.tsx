// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { Titlebar } from './Titlebar';

describe('Titlebar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('shows and invokes the right sidebar control', () => {
    const onToggleRightSidebar = vi.fn();

    act(() => {
      renderer = mountDom(<Titlebar onToggleRightSidebar={onToggleRightSidebar} />);
    });

    const button = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('titlebar.hideRightSidebar')}"]`,
    );
    expect(button).not.toBeNull();
    expect(button?.classList.contains('q-titlebar-right-sidebar')).toBe(true);

    act(() => button!.click());

    expect(onToggleRightSidebar).toHaveBeenCalledOnce();
  });
});
