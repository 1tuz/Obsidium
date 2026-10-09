// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { setTheme } from '../../modules/theme';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { SidebarFooter } from './SidebarFooter';

describe('SidebarFooter', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('shows and invokes the quick theme switch beside the workspace controls', () => {
    const onToggleTheme = vi.fn();
    setTheme('dark', 'obsidium');

    act(() => {
      renderer = mountDom(
        <SidebarFooter
          workspaceName="Vault"
          workspacePath="/vault"
          onOpenSettings={vi.fn()}
          onOpenWorkspaces={vi.fn()}
          onToggleTheme={onToggleTheme}
        />,
      );
    });

    const button = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('titlebar.switchToLightTheme')}"]`,
    );
    expect(button).not.toBeNull();
    expect(button!.parentElement?.classList.contains('q-sidebar-footer')).toBe(true);

    act(() => button!.click());

    expect(onToggleTheme).toHaveBeenCalledOnce();
  });
});
