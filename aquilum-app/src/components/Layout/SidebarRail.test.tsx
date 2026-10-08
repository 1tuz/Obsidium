// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { mountDom } from '../../testing/mountDom';
import { SidebarRail } from './SidebarRail';

describe('SidebarRail', () => {
  it('opens the file tree from an explicit file manager control', () => {
    const onOpenFiles = vi.fn();
    const rail = mountDom(
      <SidebarRail isSidebarOpen onOpenFiles={onOpenFiles} filesActive={false} />,
    );
    const button = rail.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('rail.fileManager')}"]`,
    );

    expect(button).not.toBeNull();
    act(() => button!.click());
    expect(onOpenFiles).toHaveBeenCalledOnce();
    act(() => rail.unmount());
  });
});
