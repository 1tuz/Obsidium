// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

const state = vi.hoisted(() => ({
  savedView: 0,
  loadDeferred: null as Promise<number> | null,
  rows: [] as { path: string; fields: Record<string, string> }[],
}));

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

vi.mock('../../modules/bases/gateway', () => ({ getBaseRows: vi.fn(async () => state.rows) }));

vi.mock('../../modules/ui-state/gateway', () => ({
  loadBaseView: vi.fn(() => state.loadDeferred ?? Promise.resolve(state.savedView)),
  saveBaseView: vi.fn(async (_workspace: string, _path: string, index: number) => { state.savedView = index; }),
}));

const { BaseView } = await import('./BaseView');
const { saveBaseView } = await import('../../modules/ui-state/gateway');
const { writeFileAtomic } = await import('../../modules/documents/fileGateway');

describe('BaseView view selection', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    state.rows = [];
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

  it('drags a kanban note to another value and saves that value', async () => {
    state.rows = [
      { path: '/vault/Task.md', fields: { status: 'todo' } },
      { path: '/vault/Done.md', fields: { status: 'done' } },
    ];
    const props = {
      path: '/vault/Project.base',
      workspacePath: '/vault',
      indexReady: true,
      indexRevision: 0,
      onOpenNote: vi.fn(),
      viewRequest: { path: '/vault/Project.base', index: 1, id: 1 },
    };
    act(() => { renderer = mountDom(<BaseView {...props} />); });
    await actAndSettle();

    const card = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-kanban__card')]
      .find((candidate) => candidate.textContent?.includes('Task'))!;
    expect(card.getAttribute('draggable')).toBe('true');
    const values: Record<string, string> = {};
    const dataTransfer = {
      setData: vi.fn((type: string, value: string) => { values[type] = value; }),
      getData: (type: string) => values[type] ?? '',
      effectAllowed: '',
    };
    const dragStart = new Event('dragstart', { bubbles: true });
    Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
    act(() => { card.dispatchEvent(dragStart); });
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '/vault/Task.md');
    expect(dataTransfer.effectAllowed).toBe('move');

    const columns = renderer!.container.querySelectorAll<HTMLElement>('.q-base-kanban__column');
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    const doneColumn = [...columns].find((column) => column.textContent?.includes('done'))!;
    act(() => { doneColumn.dispatchEvent(drop); });
    await actAndSettle();
    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledWith(
      '/vault/Task.md', expect.stringContaining('status: done'), 'hash',
    );
  });
});
