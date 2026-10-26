// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { mountDom } from '../../testing/mountDom';
import { SidebarRail, type RailSectionId } from './SidebarRail';

const ALL_SECTIONS: readonly RailSectionId[] = ['home', 'files', 'boards', 'calendar', 'canvas', 'graph'];

const ICONS: Record<RailSectionId, string> = {
  home: 'house',
  files: 'files',
  boards: 'kanban',
  calendar: 'calendar',
  canvas: 'canvas',
  graph: 'graph',
};

const LABELS: Record<RailSectionId, string> = {
  home: 'rail.home',
  files: 'rail.fileManager',
  boards: 'rail.boards',
  calendar: 'rail.calendar',
  canvas: 'rail.canvas',
  graph: 'rail.graph',
};

function buttonFor(container: HTMLElement, id: RailSectionId): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`[aria-label="${t(LABELS[id])}"]`);
}

describe('SidebarRail', () => {
  it('renders every requested section with its semantic icon', () => {
    const rail = mountDom(
      <SidebarRail isSidebarOpen sections={ALL_SECTIONS} activeSection={null} onSelect={() => {}} />,
    );

    for (const id of ALL_SECTIONS) {
      const button = buttonFor(rail.container, id);
      expect(button).not.toBeNull();
      expect(button?.querySelector('svg')?.getAttribute('data-icon-name')).toBe(ICONS[id]);
    }
    act(() => rail.unmount());
  });

  it('renders only the sections it is given', () => {
    const rail = mountDom(
      <SidebarRail
        isSidebarOpen
        sections={['files', 'canvas']}
        activeSection={null}
        onSelect={() => {}}
      />,
    );

    expect(buttonFor(rail.container, 'files')).not.toBeNull();
    expect(buttonFor(rail.container, 'canvas')).not.toBeNull();
    expect(buttonFor(rail.container, 'boards')).toBeNull();
    expect(buttonFor(rail.container, 'calendar')).toBeNull();
    act(() => rail.unmount());
  });

  it('marks the active section as pressed and leaves the others unpressed', () => {
    const rail = mountDom(
      <SidebarRail isSidebarOpen sections={ALL_SECTIONS} activeSection="calendar" onSelect={() => {}} />,
    );

    expect(buttonFor(rail.container, 'calendar')?.getAttribute('aria-pressed')).toBe('true');
    expect(buttonFor(rail.container, 'files')?.getAttribute('aria-pressed')).toBe('false');
    expect(buttonFor(rail.container, 'boards')?.getAttribute('aria-pressed')).toBe('false');
    expect(buttonFor(rail.container, 'canvas')?.getAttribute('aria-pressed')).toBe('false');
    act(() => rail.unmount());
  });

  it('keeps the navigation actions free of a pressed state', () => {
    const rail = mountDom(
      <SidebarRail isSidebarOpen sections={ALL_SECTIONS} activeSection="home" onSelect={() => {}} />,
    );

    expect(buttonFor(rail.container, 'home')?.hasAttribute('aria-pressed')).toBe(false);
    expect(buttonFor(rail.container, 'graph')?.hasAttribute('aria-pressed')).toBe(false);
    act(() => rail.unmount());
  });

  it('reports the selected section id', () => {
    const onSelect = vi.fn();
    const rail = mountDom(
      <SidebarRail isSidebarOpen sections={ALL_SECTIONS} activeSection={null} onSelect={onSelect} />,
    );

    for (const id of ALL_SECTIONS) {
      act(() => buttonFor(rail.container, id)!.click());
      expect(onSelect).toHaveBeenLastCalledWith(id);
    }
    expect(onSelect).toHaveBeenCalledTimes(ALL_SECTIONS.length);
    act(() => rail.unmount());
  });

  it('keeps the sidebar toggle and settings controls outside the section list', () => {
    const onToggleSidebar = vi.fn();
    const onOpenSettings = vi.fn();
    const onSelect = vi.fn();
    const rail = mountDom(
      <SidebarRail
        isSidebarOpen
        onToggleSidebar={onToggleSidebar}
        sections={['home']}
        activeSection={null}
        onSelect={onSelect}
        onOpenSettings={onOpenSettings}
      />,
    );

    const toggle = rail.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('rail.hideSidebar')}"]`,
    );
    expect(toggle?.querySelector('svg')?.getAttribute('data-icon-name')).toBe('panel-left');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    act(() => toggle!.click());
    expect(onToggleSidebar).toHaveBeenCalledOnce();

    const settings = rail.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('common.settings')}"]`,
    );
    expect(settings?.querySelector('svg')?.getAttribute('data-icon-name')).toBe('settings');
    expect(settings?.hasAttribute('aria-pressed')).toBe(false);
    act(() => settings!.click());
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    act(() => rail.unmount());
  });
});
