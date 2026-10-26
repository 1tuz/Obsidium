// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

const state = vi.hoisted(() => ({
  directories: {
    '/vault': [
      { id: '/vault/Work', name: 'Work', type: 'folder' as const },
      { id: '/vault/Plain.base', name: 'Plain.base', type: 'file' as const },
    ],
    '/vault/Work': [
      { id: '/vault/Work/Plan.base', name: 'Plan.base', type: 'file' as const },
    ],
  } as Record<string, { id: string; name: string; type: 'file' | 'folder' }[]>,
  sources: {
    '/vault/Plain.base': 'views:\n  - type: table\n    name: All\n',
    '/vault/Work/Plan.base': [
      'views:',
      '  - type: kanban',
      '    name: Sprint',
      '  - type: calendar',
      '    name: Deadlines',
      '  - type: timeline',
      '    name: Roadmap',
      '  - type: calendar',
      '    name: Releases',
    ].join('\n'),
  } as Record<string, string>,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('../../modules/documents/fileGateway', () => ({
  isBasePath: (path: string) => path.toLowerCase().endsWith('.base'),
  readDirectory: vi.fn(async (path: string) => state.directories[path] ?? []),
  readFileSnapshot: vi.fn(async (path: string) => ({
    content: state.sources[path], hash: state.sources[path], textHash: state.sources[path],
  })),
}));

const { CalendarPanel } = await import('./CalendarPanel');
const { readDirectory } = await import('../../modules/documents/fileGateway');

describe('CalendarPanel', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('lists only calendar views, grouped under the Base name', async () => {
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={() => {}} />);
    });
    await actAndSettle();

    const bases = [...renderer!.container.querySelectorAll('.q-calendar-panel__base')];
    expect(bases).toHaveLength(1);
    expect(bases[0].querySelector('.q-calendar-panel__name')?.textContent).toBe('Plan');

    const views = [...bases[0].querySelectorAll<HTMLButtonElement>('.q-calendar-panel__view')];
    expect(views.map((view) => view.textContent)).toEqual(['Deadlines', 'Releases']);
    expect(renderer!.container.textContent).not.toContain('Sprint');
    expect(renderer!.container.textContent).not.toContain('Roadmap');
  });

  it('opens the Base at the index of the clicked calendar view', async () => {
    const onOpenView = vi.fn();
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={onOpenView} />);
    });
    await actAndSettle();

    const views = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-calendar-panel__view')];
    act(() => views[0].click());
    expect(onOpenView).toHaveBeenLastCalledWith('/vault/Work/Plan.base', 1);

    act(() => views[1].click());
    expect(onOpenView).toHaveBeenLastCalledWith('/vault/Work/Plan.base', 3);
  });

  it('shows the empty state when no Base has a calendar view', async () => {
    state.sources['/vault/Work/Plan.base'] = 'views:\n  - type: kanban\n    name: Sprint\n';
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={() => {}} />);
    });
    await actAndSettle();

    expect(renderer!.container.textContent).toContain(t('calendarPanel.empty'));
    expect(renderer!.container.querySelector('.q-calendar-panel__view')).toBeNull();
    state.sources['/vault/Work/Plan.base'] = [
      'views:',
      '  - type: kanban',
      '    name: Sprint',
      '  - type: calendar',
      '    name: Deadlines',
      '  - type: timeline',
      '    name: Roadmap',
      '  - type: calendar',
      '    name: Releases',
    ].join('\n');
  });

  it('does not scan the vault until it is opened', async () => {
    vi.mocked(readDirectory).mockClear();
    act(() => {
      renderer = mountDom(<CalendarPanel active={false} workspacePath="/vault" onOpenView={() => {}} />);
    });
    await actAndSettle();

    expect(readDirectory).not.toHaveBeenCalled();
    act(() => renderer!.update(<CalendarPanel active workspacePath="/vault" onOpenView={() => {}} />));
    await actAndSettle();
    expect(readDirectory).toHaveBeenCalled();
  });
});
