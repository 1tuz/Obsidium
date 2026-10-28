// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const { createCalendarBaseFile } = vi.hoisted(() => ({ createCalendarBaseFile: vi.fn() }));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('../../modules/documents/fileGateway', () => ({
  isBasePath: (path: string) => path.toLowerCase().endsWith('.base'),
  readDirectory: vi.fn(async (path: string) => state.directories[path] ?? []),
  readFileSnapshot: vi.fn(async (path: string) => ({
    content: state.sources[path], hash: state.sources[path], textHash: state.sources[path],
  })),
  trashFile: vi.fn(),
}));
vi.mock('../../modules/bases/createCalendarBaseFile', () => ({ createCalendarBaseFile }));
vi.mock('../../modules/documents/renameWorkspaceFile', () => ({ renameWorkspaceFile: vi.fn() }));

const { CalendarPanel } = await import('./CalendarPanel');
const { readDirectory, trashFile } = await import('../../modules/documents/fileGateway');
const { renameWorkspaceFile } = await import('../../modules/documents/renameWorkspaceFile');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('CalendarPanel', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    createCalendarBaseFile.mockReset();
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
    expect([...renderer!.container.querySelectorAll('button')].some((button) => (
      button.textContent === t('calendarPanel.create')
    ))).toBe(true);
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

  it('shows actions for a calendar Base from its group heading', async () => {
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={vi.fn()} />);
    });
    await actAndSettle();

    const base = renderer!.container.querySelector<HTMLElement>('.q-calendar-panel__name')!;
    act(() => { base.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 90, clientY: 70,
    })); });
    await actAndSettle();

    expect([...document.querySelectorAll('[role="menuitem"]')].map((entry) => entry.textContent)).toEqual([
      t('fileTree.open'), t('common.rename'), t('common.delete'),
    ]);
    expect(document.querySelectorAll('.q-menu__item-icon')).toHaveLength(3);
    expect(document.querySelector('[role="menuitem"].q-menu__item--danger')?.textContent).toContain(t('common.delete'));
  });

  it('opens Base actions from the focusable action button', async () => {
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={vi.fn()} />);
    });
    await actAndSettle();
    const trigger = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('boards.actions', { name: 'Plan' })}"]`,
    )!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    trigger.focus();
    act(() => { trigger.click(); });
    await actAndSettle();

    expect(document.querySelector('.q-menu')).not.toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the first calendar view from the Base context menu', async () => {
    const onOpenView = vi.fn();
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={onOpenView} />);
    });
    await actAndSettle();
    const heading = renderer!.container.querySelector<HTMLElement>('.q-calendar-panel__name')!;
    act(() => { heading.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('fileTree.open'))!.click());

    expect(onOpenView).toHaveBeenCalledWith('/vault/Work/Plan.base', 1);
  });

  it('starts inline rename for a calendar Base from its context menu', async () => {
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={vi.fn()} />);
    });
    await actAndSettle();
    const heading = renderer!.container.querySelector<HTMLElement>('.q-calendar-panel__name')!;
    act(() => { heading.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('common.rename'))!.click());
    await actAndSettle();
    expect(renderer!.container.querySelector('.cm-content')?.textContent).toBe('Plan');
    expect(renameWorkspaceFile).not.toHaveBeenCalled();
  });

  it('moves the calendar Base to trash only after contextual delete confirmation', async () => {
    vi.mocked(trashFile).mockClear();
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={vi.fn()} />);
    });
    await actAndSettle();
    const heading = renderer!.container.querySelector<HTMLElement>('.q-calendar-panel__name')!;
    act(() => { heading.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('common.delete'))!.click());
    await actAndSettle();
    expect(trashFile).not.toHaveBeenCalled();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
      .find((button) => button.textContent === t('common.delete'))!.click());
    await actAndSettle();

    expect(trashFile).toHaveBeenCalledWith('/vault', '/vault/Work/Plan.base');
  });

  it('does not refresh the old workspace after a pending Base deletion resolves', async () => {
    const pending = deferred<string>();
    vi.mocked(trashFile).mockReturnValueOnce(pending.promise);
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={vi.fn()} />);
    });
    await actAndSettle();
    const heading = renderer!.container.querySelector<HTMLElement>('.q-calendar-panel__name')!;
    act(() => { heading.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('common.delete'))!.click());
    await actAndSettle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
      .find((button) => button.textContent === t('common.delete'))!.click());
    await actAndSettle();

    act(() => renderer!.update(<CalendarPanel active workspacePath="/other" onOpenView={vi.fn()} />));
    await actAndSettle();
    const oldWorkspaceCalls = vi.mocked(readDirectory).mock.calls
      .filter(([path]) => path === '/vault').length;
    pending.resolve('/trash/Plan.base');
    await actAndSettle();

    expect(vi.mocked(readDirectory).mock.calls.filter(([path]) => path === '/vault')).toHaveLength(oldWorkspaceCalls);
  });

  it('does not refresh the old workspace after a pending Base rename resolves', async () => {
    const pending = deferred<string | null>();
    vi.mocked(renameWorkspaceFile).mockReturnValueOnce(pending.promise);
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={vi.fn()} />);
    });
    await actAndSettle();
    const heading = renderer!.container.querySelector<HTMLElement>('.q-calendar-panel__name')!;
    act(() => { heading.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('common.rename'))!.click());
    await actAndSettle();
    const content = renderer!.container.querySelector<HTMLElement>('.cm-content')!;
    act(() => { content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    await actAndSettle();
    expect(renameWorkspaceFile).toHaveBeenCalledWith('/vault/Work/Plan.base', 'Plan');

    act(() => renderer!.update(<CalendarPanel active workspacePath="/other" onOpenView={vi.fn()} />));
    await actAndSettle();
    const oldWorkspaceCalls = vi.mocked(readDirectory).mock.calls
      .filter(([path]) => path === '/vault').length;
    pending.resolve('/vault/Work/Deadline.base');
    await actAndSettle();

    expect(vi.mocked(readDirectory).mock.calls.filter(([path]) => path === '/vault')).toHaveLength(oldWorkspaceCalls);
  });

  it('shows the empty state when no Base has a calendar view', async () => {
    state.sources['/vault/Work/Plan.base'] = 'views:\n  - type: kanban\n    name: Sprint\n';
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={() => {}} />);
    });
    await actAndSettle();

    expect(renderer!.container.textContent).toContain(t('calendarPanel.empty'));
    expect(renderer!.container.querySelector('.q-calendar-panel__view')).toBeNull();
    expect([...renderer!.container.querySelectorAll('button')].some((button) => (
      button.textContent === t('calendarPanel.create')
    ))).toBe(true);
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

  it('creates and opens a Calendar Base from the panel action', async () => {
    const onOpenView = vi.fn();
    createCalendarBaseFile.mockResolvedValue('/vault/Calendar.base');
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={onOpenView} />);
    });
    await actAndSettle();

    const createButton = [...renderer!.container.querySelectorAll('button')]
      .find((button) => button.textContent === t('calendarPanel.create'));
    expect(createButton).toBeDefined();
    act(() => createButton?.click());
    await actAndSettle();

    expect(createCalendarBaseFile).toHaveBeenCalledWith('/vault');
    expect(onOpenView).toHaveBeenCalledWith('/vault/Calendar.base', 0);
  });

  it('reports name exhaustion and creation failures', async () => {
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={vi.fn()} />);
    });
    await actAndSettle();
    const createButton = [...renderer!.container.querySelectorAll('button')]
      .find((button) => button.textContent === t('calendarPanel.create'))!;

    createCalendarBaseFile.mockResolvedValueOnce(null);
    act(() => createButton.click());
    await actAndSettle();
    expect(renderer!.container.querySelector('[role="alert"]')?.textContent)
      .toBe(t('calendarPanel.nameExhausted'));

    createCalendarBaseFile.mockRejectedValueOnce(new Error('disk full'));
    act(() => [...renderer!.container.querySelectorAll('button')]
      .find((button) => button.textContent === t('calendarPanel.create'))!.click());
    await actAndSettle();
    expect(renderer!.container.querySelector('[role="alert"]')?.textContent)
      .toBe(t('calendarPanel.createError', { reason: 'Error: disk full' }));
  });

  it('deduplicates repeated clicks and disables creation while pending', async () => {
    const pending = deferred<string | null>();
    createCalendarBaseFile.mockReturnValue(pending.promise);
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={vi.fn()} />);
    });
    await actAndSettle();
    const createButton = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('calendarPanel.create'))!;

    act(() => { createButton.click(); createButton.click(); });
    expect(createCalendarBaseFile).toHaveBeenCalledTimes(1);
    expect(createButton.disabled).toBe(true);
    expect(createButton.textContent).toBe(t('calendarPanel.creating'));

    pending.resolve('/vault/Calendar.base');
    await actAndSettle();
    expect(createButton.disabled).toBe(false);
  });

  it('does not open a created Base after the workspace changes', async () => {
    const pending = deferred<string | null>();
    const onOpenView = vi.fn();
    createCalendarBaseFile.mockReturnValue(pending.promise);
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={onOpenView} />);
    });
    await actAndSettle();
    act(() => [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('calendarPanel.create'))!.click());
    act(() => renderer!.update(
      <CalendarPanel active workspacePath="/other-vault" onOpenView={onOpenView} />,
    ));
    pending.resolve('/vault/Calendar.base');
    await actAndSettle();

    expect(onOpenView).not.toHaveBeenCalled();
  });

  it('does not open a created Base after the panel is hidden', async () => {
    const pending = deferred<string | null>();
    const onOpenView = vi.fn();
    createCalendarBaseFile.mockReturnValue(pending.promise);
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={onOpenView} />);
    });
    await actAndSettle();
    act(() => [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('calendarPanel.create'))!.click());
    act(() => renderer!.update(
      <CalendarPanel active={false} workspacePath="/vault" onOpenView={onOpenView} />,
    ));
    pending.resolve('/vault/Calendar.base');
    await actAndSettle();

    expect(onOpenView).not.toHaveBeenCalled();
  });

  it('does not open a created Base after the panel unmounts', async () => {
    const pending = deferred<string | null>();
    const onOpenView = vi.fn();
    createCalendarBaseFile.mockReturnValue(pending.promise);
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={onOpenView} />);
    });
    await actAndSettle();
    act(() => [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('calendarPanel.create'))!.click());
    act(() => renderer!.unmount());
    renderer = null;
    pending.resolve('/vault/Calendar.base');
    await actAndSettle();

    expect(onOpenView).not.toHaveBeenCalled();
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

  it('keeps the create button on one line and truncates the title instead', async () => {
    act(() => {
      renderer = mountDom(<CalendarPanel active workspacePath="/vault" onOpenView={() => {}} />);
    });
    await actAndSettle();

    const header = renderer!.container.querySelector('.q-calendar-panel__header')!;
    const create = [...header.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('calendarPanel.create'))!;
    expect(create.classList.contains('q-button--s')).toBe(true);

    const buttonStyles = readFileSync(resolve(process.cwd(), 'src/styles/components/buttons.css'), 'utf8');
    expect(buttonStyles).toMatch(/\.q-button\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(buttonStyles).toMatch(/\.q-button\s*\{[^}]*flex:\s*0 0 auto;/s);
  });
});
