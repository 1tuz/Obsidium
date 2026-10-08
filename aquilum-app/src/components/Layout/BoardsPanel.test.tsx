// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  writeFileAtomic: vi.fn(),
}));

const { BoardsPanel } = await import('./BoardsPanel');
const { readDirectory } = await import('../../modules/documents/fileGateway');

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
});
