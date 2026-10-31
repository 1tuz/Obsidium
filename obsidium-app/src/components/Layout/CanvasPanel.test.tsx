// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

const state = vi.hoisted(() => ({
  directories: {
    '/vault': [
      { id: '/vault/Boards.canvas', name: 'Boards.canvas', type: 'file' as const },
      { id: '/vault/Note.md', name: 'Note.md', type: 'file' as const },
      { id: '/vault/Work', name: 'Work', type: 'folder' as const },
    ],
    '/vault/Work': [
      { id: '/vault/Work/Architecture overview.canvas', name: 'Architecture overview.canvas', type: 'file' as const },
    ],
  } as Record<string, { id: string; name: string; type: 'file' | 'folder' }[]>,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('../../modules/documents/fileGateway', () => ({
  isCanvasPath: (path: string) => path.toLowerCase().endsWith('.canvas'),
  readDirectory: vi.fn(async (path: string) => state.directories[path] ?? []),
  trashFile: vi.fn(),
}));
vi.mock('../../modules/documents/renameWorkspaceFile', () => ({ renameWorkspaceFile: vi.fn() }));

const { CanvasPanel } = await import('./CanvasPanel');
const { readDirectory, trashFile } = await import('../../modules/documents/fileGateway');
const { renameWorkspaceFile } = await import('../../modules/documents/renameWorkspaceFile');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

describe('CanvasPanel', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    state.directories = {
      '/vault': [
        { id: '/vault/Boards.canvas', name: 'Boards.canvas', type: 'file' },
        { id: '/vault/Note.md', name: 'Note.md', type: 'file' },
        { id: '/vault/Work', name: 'Work', type: 'folder' },
      ],
      '/vault/Work': [
        { id: '/vault/Work/Architecture overview.canvas', name: 'Architecture overview.canvas', type: 'file' },
      ],
    };
  });

  it('shows the empty state for a vault without canvases', async () => {
    state.directories['/vault'] = [];
    act(() => {
      renderer = mountDom(
        <CanvasPanel active workspacePath="/vault" onOpenCanvas={() => {}} onCreateCanvas={() => {}} />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.textContent).toContain(t('canvasPanel.empty'));
    expect(renderer!.container.querySelector('.q-canvas-panel__item')).toBeNull();
  });

  it('lists every canvas with its full name and folder', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasPanel active workspacePath="/vault" onOpenCanvas={() => {}} onCreateCanvas={() => {}} />,
      );
    });
    await actAndSettle();

    const items = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-canvas-panel__item')];
    expect(items.map((item) => item.getAttribute('title')).sort()).toEqual([
      '/vault/Boards.canvas', '/vault/Work/Architecture overview.canvas',
    ]);
    expect(items.map((item) => item.textContent).sort()).toEqual(['Architecture overview', 'Boards']);
    expect(renderer!.container.textContent).toContain('Work');
    expect(renderer!.container.textContent).not.toContain(t('canvasPanel.empty'));
  });

  it('opens the clicked canvas by path', async () => {
    const onOpenCanvas = vi.fn();
    act(() => {
      renderer = mountDom(
        <CanvasPanel active workspacePath="/vault" onOpenCanvas={onOpenCanvas} onCreateCanvas={() => {}} />,
      );
    });
    await actAndSettle();

    const nested = renderer!.container.querySelector<HTMLButtonElement>(
      '.q-canvas-panel__item[title="/vault/Work/Architecture overview.canvas"]',
    );
    act(() => nested!.click());
    expect(onOpenCanvas).toHaveBeenCalledWith('/vault/Work/Architecture overview.canvas');
  });

  it('shows open, rename, and delete actions on a canvas right-click', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasPanel active workspacePath="/vault" onOpenCanvas={vi.fn()} onCreateCanvas={() => {}} />,
      );
    });
    await actAndSettle();

    const item = renderer!.container.querySelector<HTMLElement>(
      '.q-canvas-panel__item[title="/vault/Boards.canvas"]',
    )!;
    act(() => { item.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 90, clientY: 70,
    })); });
    await actAndSettle();

    expect([...document.querySelectorAll('[role="menuitem"]')].map((entry) => entry.textContent)).toEqual([
      t('fileTree.open'), t('common.rename'), t('common.delete'),
    ]);
    expect(document.querySelectorAll('.q-menu__item-icon')).toHaveLength(3);
    expect(document.querySelector('[role="menuitem"].q-menu__item--danger')?.textContent).toContain(t('common.delete'));
  });

  it('opens the selected canvas from its context menu', async () => {
    const onOpenCanvas = vi.fn();
    act(() => {
      renderer = mountDom(
        <CanvasPanel active workspacePath="/vault" onOpenCanvas={onOpenCanvas} onCreateCanvas={() => {}} />,
      );
    });
    await actAndSettle();

    const item = renderer!.container.querySelector<HTMLElement>(
      '.q-canvas-panel__item[title="/vault/Boards.canvas"]',
    )!;
    act(() => { item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('fileTree.open'))!.click(); });

    expect(onOpenCanvas).toHaveBeenCalledWith('/vault/Boards.canvas');
  });

  it('renames a canvas through the existing workspace rename service', async () => {
    vi.mocked(renameWorkspaceFile).mockResolvedValueOnce('/vault/Sketch.canvas');
    act(() => {
      renderer = mountDom(
        <CanvasPanel active workspacePath="/vault" onOpenCanvas={() => {}} onCreateCanvas={() => {}} />,
      );
    });
    await actAndSettle();
    const item = renderer!.container.querySelector<HTMLElement>(
      '.q-canvas-panel__item[title="/vault/Boards.canvas"]',
    )!;
    act(() => { item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('common.rename'))!.click(); });
    await actAndSettle();
    const content = renderer!.container.querySelector<HTMLElement>('.cm-content')!;
    const view = EditorView.findFromDOM(content)!;
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Sketch' } }));
    act(() => { content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    await actAndSettle();

    expect(renameWorkspaceFile).toHaveBeenCalledWith('/vault/Boards.canvas', 'Sketch');
  });

  it('moves a canvas to trash only after contextual delete confirmation', async () => {
    const itemPath = '/vault/Boards.canvas';
    vi.mocked(trashFile).mockClear();
    act(() => {
      renderer = mountDom(
        <CanvasPanel active workspacePath="/vault" onOpenCanvas={() => {}} onCreateCanvas={() => {}} />,
      );
    });
    await actAndSettle();

    const item = renderer!.container.querySelector<HTMLElement>(`.q-canvas-panel__item[title="${itemPath}"]`)!;
    act(() => { item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('common.delete'))!.click(); });
    await actAndSettle();
    expect(trashFile).not.toHaveBeenCalled();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
      .find((button) => button.textContent === t('common.delete'))!.click());
    await actAndSettle();

    expect(trashFile).toHaveBeenCalledWith('/vault', itemPath);
  });

  it('closes its context menu and delete dialog when the panel becomes inactive', async () => {
    const props = {
      active: true,
      workspacePath: '/vault',
      onOpenCanvas: vi.fn(),
      onCreateCanvas: vi.fn(),
    };
    act(() => { renderer = mountDom(<CanvasPanel {...props} />); });
    await actAndSettle();

    const item = renderer!.container.querySelector<HTMLElement>(
      '.q-canvas-panel__item[title="/vault/Boards.canvas"]',
    )!;
    act(() => { item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    expect(document.querySelector('.q-menu')).not.toBeNull();
    act(() => renderer!.update(<CanvasPanel {...props} active={false} />));
    await actAndSettle();
    expect(document.querySelector('.q-menu')).toBeNull();

    act(() => renderer!.update(<CanvasPanel {...props} />));
    await actAndSettle();
    const activeItem = renderer!.container.querySelector<HTMLElement>(
      '.q-canvas-panel__item[title="/vault/Boards.canvas"]',
    )!;
    act(() => { activeItem.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('common.delete'))!.click(); });
    await actAndSettle();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    act(() => renderer!.update(<CanvasPanel {...props} active={false} />));
    await actAndSettle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('does not refresh a hidden canvas workspace after a pending delete resolves', async () => {
    const pending = deferred<string>();
    vi.mocked(trashFile).mockReturnValueOnce(pending.promise);
    const props = {
      active: true,
      workspacePath: '/vault',
      onOpenCanvas: vi.fn(),
      onCreateCanvas: vi.fn(),
    };
    act(() => { renderer = mountDom(<CanvasPanel {...props} />); });
    await actAndSettle();
    const item = renderer!.container.querySelector<HTMLElement>(
      '.q-canvas-panel__item[title="/vault/Boards.canvas"]',
    )!;
    act(() => { item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('common.delete'))!.click(); });
    await actAndSettle();
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')]
      .find((button) => button.textContent === t('common.delete'))!.click());
    await actAndSettle();

    act(() => renderer!.update(<CanvasPanel {...props} active={false} />));
    await actAndSettle();
    const oldWorkspaceCalls = vi.mocked(readDirectory).mock.calls
      .filter(([path]) => path === '/vault').length;
    pending.resolve('/trash/Boards.canvas');
    await actAndSettle();

    expect(vi.mocked(readDirectory).mock.calls.filter(([path]) => path === '/vault')).toHaveLength(oldWorkspaceCalls);
  });

  it('does not refresh the old canvas workspace after a pending rename resolves', async () => {
    const pending = deferred<string | null>();
    vi.mocked(renameWorkspaceFile).mockReturnValueOnce(pending.promise);
    const props = {
      active: true,
      workspacePath: '/vault',
      onOpenCanvas: vi.fn(),
      onCreateCanvas: vi.fn(),
    };
    act(() => { renderer = mountDom(<CanvasPanel {...props} />); });
    await actAndSettle();
    const item = renderer!.container.querySelector<HTMLElement>(
      '.q-canvas-panel__item[title="/vault/Boards.canvas"]',
    )!;
    act(() => { item.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await actAndSettle();
    act(() => { [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((entry) => entry.textContent === t('common.rename'))!.click(); });
    await actAndSettle();
    const content = renderer!.container.querySelector<HTMLElement>('.cm-content')!;
    const view = EditorView.findFromDOM(content)!;
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'Sketch' } }));
    act(() => { content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
    await actAndSettle();

    act(() => renderer!.update(<CanvasPanel {...props} workspacePath="/other" />));
    await actAndSettle();
    const oldWorkspaceCalls = vi.mocked(readDirectory).mock.calls
      .filter(([path]) => path === '/vault').length;
    pending.resolve('/vault/Sketch.canvas');
    await actAndSettle();

    expect(vi.mocked(readDirectory).mock.calls.filter(([path]) => path === '/vault')).toHaveLength(oldWorkspaceCalls);
  });

  it('creates a canvas from the explicit create control', async () => {
    const onCreateCanvas = vi.fn();
    const onOpenCanvas = vi.fn();
    act(() => {
      renderer = mountDom(
        <CanvasPanel
          active
          workspacePath="/vault"
          onOpenCanvas={onOpenCanvas}
          onCreateCanvas={onCreateCanvas}
        />,
      );
    });
    await actAndSettle();

    const create = renderer!.container.querySelector<HTMLButtonElement>(
      '.q-sidebar-panel-header__action',
    );
    expect(create).toBeDefined();
    expect(create?.getAttribute('aria-label')).toBe(t('canvasPanel.create'));
    act(() => create!.click());
    expect(onCreateCanvas).toHaveBeenCalledOnce();
    expect(onOpenCanvas).not.toHaveBeenCalled();
  });

  it('disables creation when no workspace is selected', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasPanel active workspacePath={null} onOpenCanvas={() => {}} onCreateCanvas={() => {}} />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.querySelector<HTMLButtonElement>(
      '.q-sidebar-panel-header__action',
    )?.disabled).toBe(true);
  });

  it('scans only while it is open', async () => {
    act(() => {
      renderer = mountDom(
        <CanvasPanel active={false} workspacePath="/vault" onOpenCanvas={() => {}} onCreateCanvas={() => {}} />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.querySelector('.q-canvas-panel__item')).toBeNull();
    act(() => renderer!.update(
      <CanvasPanel active workspacePath="/vault" onOpenCanvas={() => {}} onCreateCanvas={() => {}} />,
    ));
    await actAndSettle();
    expect(renderer!.container.querySelectorAll('.q-canvas-panel__item')).toHaveLength(2);
  });
});
