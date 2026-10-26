// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
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
}));

const { CanvasPanel } = await import('./CanvasPanel');

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

    const create = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('canvasPanel.create'));
    expect(create).toBeDefined();
    act(() => create!.click());
    expect(onCreateCanvas).toHaveBeenCalledOnce();
    expect(onOpenCanvas).not.toHaveBeenCalled();
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
