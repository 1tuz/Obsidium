// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { mountDom } from '../../testing/mountDom';
import { setIconSet } from '../../modules/iconSet';
import { SidebarRail } from './SidebarRail';

describe('SidebarRail', () => {
  it('labels the Canvas control as creating a board', () => {
    const rail = mountDom(<SidebarRail isSidebarOpen onOpenCanvas={() => {}} canvasActive={false} />);
    const button = rail.container.querySelector<HTMLButtonElement>(`[aria-label="${t('rail.canvas')}"]`);

    expect(t('rail.canvas')).toBe('New Canvas');
    expect(rail.container.querySelector('[aria-label="Open Canvas"]')).toBeNull();
    expect(button).not.toBeNull();
    act(() => rail.unmount());
  });

  it('creates a Canvas from the rail', () => {
    const onOpenCanvas = vi.fn();
    const rail = mountDom(
      <SidebarRail isSidebarOpen onOpenCanvas={onOpenCanvas} canvasActive />,
    );
    const button = rail.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('rail.canvas')}"]`,
    );

    expect(button?.getAttribute('aria-pressed')).toBe('true');
    act(() => button!.click());
    expect(onOpenCanvas).toHaveBeenCalledOnce();
    act(() => rail.unmount());
  });

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

  it('renders visible Phosphor icons throughout the rail', async () => {
    await act(async () => setIconSet('phosphor'));
    const rail = mountDom(
      <SidebarRail
        isSidebarOpen
        onToggleSidebar={() => {}}
        onOpenHome={() => {}}
        onOpenGraph={() => {}}
        onOpenBoards={() => {}}
        onOpenFiles={() => {}}
        onOpenCanvas={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    const icons = [...rail.container.querySelectorAll<SVGSVGElement>('svg[data-icon-set="phosphor"]')];

    expect(icons).toHaveLength(7);
    expect(icons.every((icon) => icon.getAttribute('viewBox') === '0 0 256 256')).toBe(true);
    act(() => rail.unmount());
    await act(async () => setIconSet('lucide'));
  });
});
