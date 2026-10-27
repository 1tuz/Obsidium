// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

const state = vi.hoisted(() => ({
  directories: {
    '/vault': [{ id: '/vault/Work', name: 'Work', type: 'folder' as const }],
    '/vault/Work': [{ id: '/vault/Work/Bugs.base', name: 'Bugs.base', type: 'file' as const }],
  } as Record<string, { id: string; name: string; type: 'file' | 'folder' }[]>,
  sources: {
    '/vault/Work/Bugs.base': 'views:\n  - type: kanban\n    name: Open\n',
  } as Record<string, string>,
  listener: null as null | ((event: { payload: string[] }) => void),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: string[] }) => void) => {
    state.listener = handler;
    return () => { state.listener = null; };
  }),
}));

vi.mock('../../modules/documents/fileGateway', () => ({
  createAtFreeName: vi.fn(),
  createFile: vi.fn(),
  isBasePath: (path: string) => path.toLowerCase().endsWith('.base'),
  isMarkdownPath: (path: string) => path.toLowerCase().endsWith('.md'),
  readDirectory: vi.fn(async (path: string) => state.directories[path] ?? []),
  readFileSnapshot: vi.fn(async (path: string) => ({
    content: state.sources[path], hash: state.sources[path], textHash: state.sources[path],
  })),
  trashFile: vi.fn(),
  writeFileAtomic: vi.fn(),
}));

vi.mock('../../modules/documents/renameWorkspaceFile', () => ({
  renameWorkspaceFile: vi.fn(async (
    oldPath: string, name: string, transform?: (content: string, stem: string) => string,
  ) => {
    const path = oldPath.replace(/[^/]+\.base$/u, `${name}.base`);
    const content = state.sources[oldPath];
    state.sources[path] = transform?.(content, name) ?? content;
    delete state.sources[oldPath];
    for (const entries of Object.values(state.directories)) {
      const file = entries.find((entry) => entry.id === oldPath);
      if (file) { file.id = path; file.name = `${name}.base`; }
    }
    return path;
  }),
}));

const { BoardsPanel } = await import('./BoardsPanel');
const { createAtFreeName, createFile, readDirectory, trashFile } = await import('../../modules/documents/fileGateway');
const { renameWorkspaceFile } = await import('../../modules/documents/renameWorkspaceFile');

describe('BoardsPanel', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    state.listener = null;
    state.directories = {
      '/vault': [{ id: '/vault/Work', name: 'Work', type: 'folder' }],
      '/vault/Work': [{ id: '/vault/Work/Bugs.base', name: 'Bugs.base', type: 'file' }],
    };
    state.sources = { '/vault/Work/Bugs.base': 'views:\n  - type: kanban\n    name: Open\n' };
  });

  it('scans only while open, preserves folder nesting, opens the selected view, and refreshes on Base changes', async () => {
    const onOpenView = vi.fn();
    const props = {
      active: false,
      workspacePath: '/vault',
      onOpenView,
      actionRequest: null,
      onActionRequestComplete: vi.fn(),
      createRequest: 0,
    };
    act(() => { renderer = mountDom(<BoardsPanel {...props} />); });
    await actAndSettle();
    expect(readDirectory).not.toHaveBeenCalled();

    act(() => renderer!.update(<BoardsPanel {...props} active />));
    await actAndSettle();
    vi.mocked(readDirectory).mockClear();
    act(() => state.listener?.({ payload: ['/vault/Work/note.md'] }));
    await actAndSettle(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(readDirectory).not.toHaveBeenCalled();

    expect(renderer!.container.textContent).toContain('Work');
    const view = [...renderer!.container.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('Open'));
    expect(view).toBeDefined();
    act(() => view?.click());
    expect(onOpenView).toHaveBeenCalledWith('/vault/Work/Bugs.base', 0);

    state.directories['/vault'].push({ id: '/vault/Releases.base', name: 'Releases.base', type: 'file' });
    state.sources['/vault/Releases.base'] = 'views:\n  - type: kanban\n    name: Releases\n';
    act(() => state.listener?.({ payload: ['/vault/Releases.base'] }));
    await actAndSettle(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(renderer!.container.textContent).toContain('Releases');
  });

  it('lists kanban views only and keeps the Base name visible', async () => {
    state.sources['/vault/Work/Bugs.base'] = [
      'filters: "file.hasTag(\\"board/доска\\")"',
      'views:',
      '  - type: kanban',
      '    name: Доска',
      '  - type: calendar',
      '    name: Календарь',
      '    dateField: date',
      '  - type: timeline',
      '    name: Таймлайн',
    ].join('\n');
    const onOpenView = vi.fn();
    act(() => {
      renderer = mountDom(
        <BoardsPanel
          active
          workspacePath="/vault"
          onOpenView={onOpenView}
          actionRequest={null}
          onActionRequestComplete={vi.fn()}
          createRequest={0}
        />,
      );
    });
    await actAndSettle();

    const heading = renderer!.container.querySelector('.q-boards-tree__heading strong');
    expect(heading?.textContent).toBe('Bugs');
    expect(renderer!.container.textContent).toContain('Доска');
    expect(renderer!.container.textContent).not.toContain('Календарь');
    expect(renderer!.container.textContent).not.toContain('Таймлайн');

    const board = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-boards-tree__view button')]
      .find((button) => button.textContent?.includes('Доска'));
    act(() => board!.click());
    expect(onOpenView).toHaveBeenCalledWith('/vault/Work/Bugs.base', 0);
  });

  it('reports an empty kanban list when only other view types exist', async () => {
    state.sources['/vault/Work/Bugs.base'] = [
      'views:',
      '  - type: calendar',
      '    name: Календарь',
      '    dateField: date',
    ].join('\n');
    act(() => {
      renderer = mountDom(
        <BoardsPanel
          active
          workspacePath="/vault"
          onOpenView={vi.fn()}
          actionRequest={null}
          onActionRequestComplete={vi.fn()}
          createRequest={0}
        />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.textContent).toContain(t('boards.emptyKanban'));
    expect(renderer!.container.querySelector('.q-boards-tree')).toBeNull();
  });

  it('offers board file rename and delete actions', async () => {
    const props = {
      active: true,
      workspacePath: '/vault',
      onOpenView: vi.fn(),
      onBoardRenamed: vi.fn(),
      actionRequest: null,
      onActionRequestComplete: vi.fn(),
      createRequest: 0,
    };
    act(() => { renderer = mountDom(<BoardsPanel {...props} />); });
    await actAndSettle();

    const menuButton = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('boards.actions', { name: 'Bugs' })}"]`,
    );
    expect(menuButton).not.toBeNull();
    const heading = renderer!.container.querySelector('.q-boards-tree__heading');
    expect(heading?.contains(menuButton)).toBe(true);
    expect(heading?.querySelector('strong')?.textContent).toBe('Bugs');
    expect(renderer!.container.querySelector('.q-boards-tree__view button[title="/vault/Work/Bugs.base"]')).not.toBeNull();
    act(() => menuButton!.click());
    await actAndSettle();
    expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
      t('fileTree.open'), t('common.rename'), t('common.delete'),
    ]);
    expect(document.querySelectorAll('.q-menu__item-icon')).toHaveLength(3);
    expect(document.querySelector('[role="menuitem"].q-menu__item--danger')?.textContent).toContain(t('common.delete'));

    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === t('common.rename'))!.click());
    await actAndSettle();
    const renameDialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const input = renameDialog?.querySelector<HTMLInputElement>('input');
    expect(input?.value).toBe('Bugs');
    input!.value = 'Roadmap';
    act(() => { input!.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => [...renameDialog!.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('common.rename'))!.click());
    await actAndSettle();
    expect(renameWorkspaceFile).toHaveBeenCalledWith(
      '/vault/Work/Bugs.base', 'Roadmap', expect.any(Function),
    );
    const renameCalls = vi.mocked(renameWorkspaceFile).mock.calls;
    const renameContent = renameCalls[renameCalls.length - 1]?.[2];
    expect(renameContent?.('views:\n  - type: kanban\n    name: Open\n', 'Roadmap'))
      .toBe('views:\n  - type: kanban\n    name: "Roadmap"\n');
    expect(props.onBoardRenamed).toHaveBeenCalledWith('/vault/Work/Bugs.base', '/vault/Work/Roadmap.base');
    expect(renderer!.container.textContent).toContain('Roadmap');
    expect(renderer!.container.textContent).not.toContain('Bugs');
    act(() => state.listener?.({ payload: ['/vault/Work/Roadmap.base'] }));
    await actAndSettle(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(renderer!.container.textContent).toContain('Roadmap');

    act(() => renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('boards.actions', { name: 'Roadmap' })}"]`,
    )!.click());
    await actAndSettle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === t('common.delete'))!.click());
    await actAndSettle();
    const deleteDialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(deleteDialog?.textContent).toContain('Roadmap');
    act(() => [...deleteDialog!.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('common.delete'))!.click());
    await actAndSettle();
    expect(trashFile).toHaveBeenCalledWith('/vault', '/vault/Work/Roadmap.base');
  });

  it('opens the existing board actions from a right-click on its heading', async () => {
    const onOpenView = vi.fn();
    act(() => {
      renderer = mountDom(
        <BoardsPanel
          active
          workspacePath="/vault"
          onOpenView={onOpenView}
          actionRequest={null}
          onActionRequestComplete={vi.fn()}
          createRequest={0}
        />,
      );
    });
    await actAndSettle();

    const heading = renderer!.container.querySelector<HTMLElement>('.q-boards-tree__heading')!;
    act(() => { heading.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 90, clientY: 70,
    })); });
    await actAndSettle();

    expect([...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
      t('fileTree.open'), t('common.rename'), t('common.delete'),
    ]);
    expect(document.querySelectorAll('.q-menu__item-icon')).toHaveLength(3);
    expect(document.querySelector('[role="menuitem"].q-menu__item--danger')?.textContent).toContain(t('common.delete'));
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === t('fileTree.open'))!.click(); });
    expect(onOpenView).toHaveBeenCalledWith('/vault/Work/Bugs.base', 0);
  });

  it('closes board menus and dialogs when the panel scope changes', async () => {
    const props = {
      active: true,
      workspacePath: '/vault',
      onOpenView: vi.fn(),
      actionRequest: null,
      onActionRequestComplete: vi.fn(),
      createRequest: 0,
    };
    act(() => { renderer = mountDom(<BoardsPanel {...props} />); });
    await actAndSettle();

    const heading = renderer!.container.querySelector<HTMLElement>('.q-boards-tree__heading')!;
    act(() => { heading.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    expect(document.querySelector('.q-menu')).not.toBeNull();
    act(() => renderer!.update(<BoardsPanel {...props} active={false} />));
    await actAndSettle();
    expect(document.querySelector('.q-menu')).toBeNull();

    act(() => renderer!.update(<BoardsPanel {...props} active />));
    await actAndSettle();
    const activeHeading = renderer!.container.querySelector<HTMLElement>('.q-boards-tree__heading')!;
    act(() => { activeHeading.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === t('common.delete'))!.click(); });
    await actAndSettle();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => renderer!.update(<BoardsPanel {...props} active={false} />));
    await actAndSettle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('discards an in-flight scan when the workspace changes while hidden', async () => {
    let resolveRoot!: (entries: Awaited<ReturnType<typeof readDirectory>>) => void;
    const pendingRoot = new Promise<Awaited<ReturnType<typeof readDirectory>>>((resolve) => {
      resolveRoot = resolve;
    });
    vi.mocked(readDirectory).mockImplementationOnce(() => pendingRoot);
    const props = {
      active: true,
      workspacePath: '/vault',
      onOpenView: vi.fn(),
      actionRequest: null,
      onActionRequestComplete: vi.fn(),
      createRequest: 0,
    };
    act(() => { renderer = mountDom(<BoardsPanel {...props} />); });
    await actAndSettle();

    act(() => renderer!.update(<BoardsPanel {...props} active={false} workspacePath="/other" />));
    await actAndSettle();
    act(() => resolveRoot([{ id: '/vault/Work', name: 'Work', type: 'folder' }]));
    await actAndSettle();

    expect(renderer!.container.textContent).not.toContain('Bugs');
  });

  it('creates a new board with a dedicated tag by default and opens it', async () => {
    state.directories['/vault'] = [];
    const onOpenView = vi.fn();
    const props = {
      active: true, workspacePath: '/vault', onOpenView,
      actionRequest: null, onActionRequestComplete: vi.fn(), createRequest: 0,
    };
    act(() => { renderer = mountDom(<BoardsPanel {...props} />); });
    await actAndSettle();
    expect(renderer!.container.textContent).toContain(t('boards.emptyKanban'));
    act(() => renderer!.container.querySelector<HTMLButtonElement>('.q-boards-panel__header button')!.click());
    await actAndSettle();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.textContent).toContain(t('boards.newBoard'));
    const nameInput = dialog.querySelector<HTMLInputElement>('input')!;
    expect(dialog.querySelector<HTMLSelectElement>('select')?.value).toBe('tag');
    nameInput.value = 'Sprint';
    act(() => { nameInput.dispatchEvent(new Event('input', { bubbles: true })); });
    await actAndSettle();
    vi.mocked(createAtFreeName).mockImplementationOnce(async (pathFor, create) => {
      const candidate = pathFor(0);
      await create(candidate);
      return candidate;
    });
    const submit = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('boards.create'))!;
    act(() => submit.click());
    await actAndSettle();
    expect(createFile).toHaveBeenCalledWith(
      '/vault/Sprint.base', expect.stringContaining('board/sprint'),
    );
    expect(onOpenView).toHaveBeenCalledWith('/vault/Sprint.base', 0);
  });
});
