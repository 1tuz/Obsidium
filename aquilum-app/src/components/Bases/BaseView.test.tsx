// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

const state = vi.hoisted(() => ({ savedView: 0, loadDeferred: null as Promise<number> | null }));

vi.mock('../../modules/documents/fileGateway', () => ({
  readFileSnapshot: vi.fn(async () => ({ content: [
    'views:',
    '  - type: table',
    '    name: Overview',
    '  - type: kanban',
    '    name: By status',
    '  - type: kanban',
    '    name: By owner',
  ].join('\n'), hash: 'hash', textHash: 'hash' })),
  writeFileAtomic: vi.fn(async () => ({ hash: 'saved' })),
}));

vi.mock('../../modules/bases/gateway', () => ({ getBaseRows: vi.fn(async () => []) }));

vi.mock('../../modules/ui-state/gateway', () => ({
  loadBaseView: vi.fn(() => state.loadDeferred ?? Promise.resolve(state.savedView)),
  saveBaseView: vi.fn(async (_workspace: string, _path: string, index: number) => { state.savedView = index; }),
}));

const { BaseView } = await import('./BaseView');
const { saveBaseView } = await import('../../modules/ui-state/gateway');

describe('BaseView view selection', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('opens the requested view and remembers it for an ordinary reopen', async () => {
    const props = {
      path: '/vault/Project.base',
      workspacePath: '/vault',
      indexReady: true,
      indexRevision: 0,
      onOpenNote: vi.fn(),
    };
    act(() => {
      renderer = mountDom(<BaseView {...props} viewRequest={{ path: props.path, index: 2, id: 1 }} />);
    });
    await actAndSettle();

    const viewTabs = [...renderer!.container.querySelectorAll('[role="tab"]')];
    expect(viewTabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true']);
    expect(vi.mocked(saveBaseView)).toHaveBeenCalledWith('/vault', props.path, 2);

    act(() => {
      viewTabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await actAndSettle();
    expect(state.savedView).toBe(1);

    act(() => {
      renderer!.unmount();
      renderer = mountDom(<BaseView {...props} />);
    });
    await actAndSettle();
    expect([...renderer!.container.querySelectorAll('[role="tab"]')]
      .map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
  });

  it('does not let a delayed saved view overwrite a view the user just selected', async () => {
    let resolveLoad!: (index: number) => void;
    state.loadDeferred = new Promise((resolve) => { resolveLoad = resolve; });
    const props = {
      path: '/vault/Project.base',
      workspacePath: '/vault',
      indexReady: true,
      indexRevision: 0,
      onOpenNote: vi.fn(),
    };
    act(() => { renderer = mountDom(<BaseView {...props} />); });
    await actAndSettle();

    const viewTabs = [...renderer!.container.querySelectorAll('[role="tab"]')];
    act(() => { viewTabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await actAndSettle();
    await act(async () => { resolveLoad(2); });
    await actAndSettle();

    expect([...renderer!.container.querySelectorAll('[role="tab"]')]
      .map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    state.loadDeferred = null;
  });
});
