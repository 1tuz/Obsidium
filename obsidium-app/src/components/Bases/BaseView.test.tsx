// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

const state = vi.hoisted(() => ({
  savedView: 0,
  loadDeferred: null as Promise<number> | null,
  rows: [] as { path: string; fields: Record<string, string> }[],
}));

vi.mock('../../modules/documents/fileGateway', () => ({
  createAtFreeName: vi.fn(async (pathFor: (attempt: number) => string, create: (path: string) => Promise<unknown>) => {
    const path = pathFor(0);
    await create(path);
    return path;
  }),
  createFile: vi.fn(async () => ({ hash: 'new' })),
  ensureDirectory: vi.fn(async () => undefined),
  readFileSnapshot: vi.fn(async () => ({ content: [
    'views:',
    '  - type: table',
    '    name: Overview',
    '  - type: kanban',
    '    name: By status',
    '    groupBy:',
    '      property: status',
    '    groupOrder: [todo, doing, done]',
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
const { createFile, writeFileAtomic } = await import('../../modules/documents/fileGateway');

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

  it('moves a kanban note to another value and saves that value', async () => {
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
    const select = card.querySelector<HTMLSelectElement>('.q-base-kanban__move')!;
    act(() => {
      select.value = 'done';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await actAndSettle();
    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledWith(
      '/vault/Task.md', expect.stringContaining('status: done'), 'hash',
    );
  });

  it('keeps notes without a group value in an unassigned column', async () => {
    state.rows = [{ path: '/vault/Unsorted.md', fields: {} }];
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

    expect(renderer!.container.textContent).toContain(t('bases.kanbanUnassigned'));
    expect(renderer!.container.textContent).toContain('Unsorted');
  });

  it('adds a Markdown card in the selected Kanban column using the footer plus', async () => {
    const props = {
      path: '/vault/Project.base', workspacePath: '/vault', indexReady: true, indexRevision: 0,
      onOpenNote: vi.fn(), viewRequest: { path: '/vault/Project.base', index: 1, id: 2 },
    };
    act(() => { renderer = mountDom(<BaseView {...props} />); });
    await actAndSettle();

    const addButton = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-base-kanban__add')]
      .find((button) => button.getAttribute('aria-label') === t('bases.kanbanAddTo', { column: 'todo' }));
    expect(addButton).toBeDefined();
    act(() => addButton!.click());
    await actAndSettle();
    const input = renderer!.container.querySelector<HTMLInputElement>('.q-base-kanban__composer input')!;
    input.value = 'Ship patch';
    act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
    await actAndSettle();
    const createButton = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-base-kanban__composer button')]
      .find((button) => button.textContent === t('bases.kanbanCreate'))!;
    act(() => createButton.click());
    await actAndSettle();

    expect(createFile).toHaveBeenCalledWith(
      '/vault/Ship patch.md', '---\nstatus: "todo"\n---\n\n# Ship patch\n',
    );
    expect(renderer!.container.textContent).toContain('Ship patch');
  });

  it('moves an unassigned card using the keyboard-accessible column selector', async () => {
    state.rows = [{ path: '/vault/Unsorted.md', fields: {} }];
    act(() => { renderer = mountDom(<BaseView
      path="/vault/Project.base" workspacePath="/vault" indexReady indexRevision={0}
      onOpenNote={vi.fn()} viewRequest={{ path: '/vault/Project.base', index: 1, id: 3 }}
    />); });
    await actAndSettle();
    const unassigned = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-kanban__column')]
      .find((column) => column.querySelector('.q-base-kanban__card')?.textContent?.includes('Unsorted'))!;
    const select = unassigned.querySelector<HTMLSelectElement>('.q-base-kanban__move')!;
    act(() => {
      select.value = 'todo';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await actAndSettle();
    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledWith(
      '/vault/Unsorted.md', expect.stringContaining('status: todo'), 'hash',
    );
  });
});
