// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

const state = vi.hoisted(() => ({
  savedView: 0,
  loadDeferred: null as Promise<number> | null,
  rows: [] as { path: string; fields: Record<string, string | number> }[],
  errors: [] as { formula: string; path: string; message: string }[],
  columns: [] as string[],
  baseContent: null as string | null,
  journalDates: [] as string[],
}));

vi.mock('../../modules/documents/fileGateway', () => ({
  createAtFreeName: vi.fn(async (pathFor: (attempt: number) => string, create: (path: string) => Promise<unknown>) => {
    const path = pathFor(0);
    await create(path);
    return path;
  }),
  createFile: vi.fn(async () => ({ hash: 'new' })),
  ensureDirectory: vi.fn(async () => undefined),
  readFileSnapshot: vi.fn(async () => ({ content: state.baseContent ?? [
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
    '  - type: calendar',
    '    name: Schedule',
    '    dateField: due',
  ].join('\n'), hash: 'hash', textHash: 'hash' })),
  writeFileAtomic: vi.fn(async () => ({ hash: 'saved' })),
  trashFile: vi.fn(async () => '/vault/.trash/Task.md'),
}));

vi.mock('../../modules/documents/renameWorkspaceFile', () => ({
  renameWorkspaceFile: vi.fn(async (_path: string, title: string) => `/vault/${title}.md`),
}));

vi.mock('../../modules/bases/gateway', () => ({
  getBaseRows: vi.fn(async () => state.rows),
  queryBase: vi.fn(async () => ({
    rows: state.rows,
    groups: [{ label: null, start: 0, end: state.rows.length }],
    columns: state.columns.length > 0 ? state.columns : ['file.name'],
    unsupported: false,
    errors: state.errors,
  })),
}));

vi.mock('../../modules/ui-state/gateway', () => ({
  loadBaseView: vi.fn(() => state.loadDeferred ?? Promise.resolve(state.savedView)),
  saveBaseView: vi.fn(async (_workspace: string, _path: string, index: number) => { state.savedView = index; }),
}));

vi.mock('../../modules/journal', () => ({
  journalDates: vi.fn(async () => state.journalDates),
  journalNotePath: vi.fn(async (_workspace: string, date: string) => `/vault/journal/${date}.md`),
}));

const { BaseView } = await import('./BaseView');
const { getBaseRows, queryBase } = await import('../../modules/bases/gateway');
const { saveBaseView } = await import('../../modules/ui-state/gateway');
const { createFile, writeFileAtomic } = await import('../../modules/documents/fileGateway');

describe('BaseView view selection', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    state.rows = [];
    state.errors = [];
    state.columns = [];
    state.baseContent = null;
    state.journalDates = [];
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
    expect(viewTabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true')).toBe(2);
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
      .findIndex((tab) => tab.getAttribute('aria-selected') === 'true')).toBe(1);
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
      .findIndex((tab) => tab.getAttribute('aria-selected') === 'true')).toBe(1);
    state.loadDeferred = null;
  });

  it('creates a dated note from a calendar that filters by tag', async () => {
    state.baseContent = [
      'filters: "file.hasTag(\\"board/доска\\")"',
      'views:',
      '  - type: calendar',
      '    name: Календарь',
      '    dateField: date',
    ].join('\n');
    const props = {
      path: '/vault/Доска.base', workspacePath: '/vault', indexReady: true, indexRevision: 0,
      onOpenNote: vi.fn(),
    };
    act(() => { renderer = mountDom(<BaseView {...props} />); });
    await actAndSettle();

    const cell = renderer!.container.querySelector<HTMLElement>('.q-base-calendar__day--today')!;
    const date = cell.getAttribute('aria-label')!;
    act(() => cell.querySelector<HTMLButtonElement>('.q-base-calendar__add')!.click());
    await actAndSettle();

    expect(createFile).toHaveBeenCalledWith(
      `/vault/${date}.md`,
      `---\ntags: ["board/доска"]\ndate: "${date}"\n---\n\n# ${date}\n`,
    );
    expect(renderer!.container.querySelector('[role="alert"]')).toBeNull();
  });

  it('adds a calendar view to the file and switches to it', async () => {
    state.rows = [{ path: '/vault/Release.md', fields: { due: '2026-10-05' } }];
    const props = {
      path: '/vault/Project.base', workspacePath: '/vault', indexReady: true, indexRevision: 0,
      onOpenNote: vi.fn(),
    };
    act(() => { renderer = mountDom(<BaseView {...props} />); });
    await actAndSettle();

    const add = renderer!.container.querySelector<HTMLButtonElement>('.q-base-view__add')!;
    act(() => add.click());
    await actAndSettle();
    const calendar = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-base-view__add-menu button')]
      .find((button) => button.textContent === t('bases.viewType.calendar'))!;
    act(() => calendar.click());
    await actAndSettle();

    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledWith(
      '/vault/Project.base',
      expect.stringContaining('type: "calendar"'),
      'hash',
    );
    expect(vi.mocked(writeFileAtomic).mock.calls[0][1]).toContain('dateField: "due"');
    expect(renderer!.container.querySelector('.q-base-calendar')).not.toBeNull();
  });

  it('renders a formula column and reports a broken formula', async () => {
    state.baseContent = [
      'formulas:',
      '  risk: "priority"',
      'views:',
      '  - type: table',
      '    name: Overview',
      '    order: [file.name, "formula.risk"]',
    ].join('\n');
    state.rows = [{ path: '/vault/A.md', fields: { 'formula.risk': 1 } }];
    state.columns = ['file.name', 'formula.risk'];
    state.errors = [{ formula: 'risk', path: '/vault/A.md', message: 'Нет функции «nosuchfunction»' }];
    const props = {
      path: '/vault/Project.base', workspacePath: '/vault', indexReady: true, indexRevision: 0,
      onOpenNote: vi.fn(),
    };
    act(() => { renderer = mountDom(<BaseView {...props} />); });
    await actAndSettle();

    expect([...renderer!.container.querySelectorAll('th button')].map((button) => button.textContent))
      .toEqual(['Name', 'risk']);
    expect([...renderer!.container.querySelectorAll('tbody td')][1]?.textContent).toBe('1');
    expect(renderer!.container.querySelector('[role="alert"]')?.textContent)
      .toBe('formula.risk: Нет функции «nosuchfunction»');
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

  it('shows dated notes in a month grid and creates a note on a day', async () => {
    const due = new Date().toISOString().slice(0, 10);
    state.rows = [{ path: '/vault/Release.md', fields: { due } }];
    const props = {
      path: '/vault/Project.base', workspacePath: '/vault', indexReady: true, indexRevision: 0,
      onOpenNote: vi.fn(), viewRequest: { path: '/vault/Project.base', index: 3, id: 4 },
    };
    act(() => { renderer = mountDom(<BaseView {...props} />); });
    await actAndSettle();

    const cell = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-calendar__day')]
      .find((candidate) => candidate.textContent?.includes('Release'))!;
    expect(cell.getAttribute('aria-label')).toBe(due);

    act(() => cell.querySelector<HTMLButtonElement>('.q-base-calendar__add')!.click());
    await actAndSettle();

    expect(createFile).toHaveBeenCalledWith(
      `/vault/${due}.md`, `---\ndue: "${due}"\n---\n\n# ${due}\n`,
    );
  });

  it('marks calendar days that have a daily note and opens the note on click', async () => {
    const due = new Date().toISOString().slice(0, 10);
    state.journalDates = [due];
    const onOpenNote = vi.fn();
    act(() => { renderer = mountDom(<BaseView path="/vault/Project.base" workspacePath="/vault"
      indexReady indexRevision={0} onOpenNote={onOpenNote}
      viewRequest={{ path: '/vault/Project.base', index: 3, id: 5 }} />); });
    await actAndSettle();

    const marker = renderer!.container.querySelector<HTMLButtonElement>('.q-base-calendar__journal');
    expect(marker?.closest('.q-base-calendar__day')?.getAttribute('aria-label')).toBe(due);
    act(() => marker!.click());
    await actAndSettle();
    expect(onOpenNote).toHaveBeenCalledWith(`/vault/journal/${due}.md`);
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

  it('opens a card by clicking its surface, not only its title', async () => {
    state.rows = [{ path: '/vault/Task.md', fields: { status: 'todo' } }];
    const onOpenNote = vi.fn();
    act(() => { renderer = mountDom(<BaseView path="/vault/Project.base" workspacePath="/vault"
      indexReady indexRevision={0} onOpenNote={onOpenNote}
      viewRequest={{ path: '/vault/Project.base', index: 1, id: 4 }} />); });
    await actAndSettle();
    const card = renderer!.container.querySelector<HTMLElement>('.q-base-kanban__card')!;
    act(() => { card.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onOpenNote).toHaveBeenCalledWith('/vault/Task.md');
  });

  it('asks the Rust engine for the selected view and the header sort', async () => {
    state.rows = [{ path: '/vault/Task.md', fields: { status: 'todo' } }];
    act(() => { renderer = mountDom(<BaseView path="/vault/Project.base" workspacePath="/vault"
      indexReady indexRevision={0} onOpenNote={vi.fn()}
      viewRequest={{ path: '/vault/Project.base', index: 0, id: 6 }} />); });
    await actAndSettle();
    expect(vi.mocked(queryBase)).toHaveBeenLastCalledWith('/vault', expect.objectContaining({
      viewIndex: 0,
      sort: [],
    }));
    expect(vi.mocked(getBaseRows)).not.toHaveBeenCalled();

    const header = renderer!.container.querySelector<HTMLButtonElement>('.q-base-table th button')!;
    act(() => header.click());
    await actAndSettle();
    expect(vi.mocked(queryBase)).toHaveBeenLastCalledWith('/vault', expect.objectContaining({
      sort: [{ property: 'file.name', direction: 'ASC' }],
    }));
  });

  it('uses pointer movement to transfer a card to another Kanban column', async () => {
    state.rows = [{ path: '/vault/Task.md', fields: { status: 'todo' } }];
    act(() => { renderer = mountDom(<BaseView path="/vault/Project.base" workspacePath="/vault"
      indexReady indexRevision={0} onOpenNote={vi.fn()}
      viewRequest={{ path: '/vault/Project.base', index: 1, id: 5 }} />); });
    await actAndSettle();
    const card = renderer!.container.querySelector<HTMLElement>('.q-base-kanban__card')!;
    card.setPointerCapture = vi.fn();
    const target = [...renderer!.container.querySelectorAll<HTMLElement>('[data-kanban-column]')]
      .find((item) => item.dataset.kanbanColumn === 'done')!;
    const original = document.elementFromPoint;
    document.elementFromPoint = vi.fn(() => target);
    const pointerEvent = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        pointerId: { value: 1 }, button: { value: 0 }, clientX: { value: x }, clientY: { value: 10 },
      });
      return event;
    };
    try {
      act(() => { card.dispatchEvent(pointerEvent('pointerdown', 10)); });
      act(() => { card.dispatchEvent(pointerEvent('pointermove', 70)); });
      act(() => { card.dispatchEvent(pointerEvent('pointerup', 70)); });
      await actAndSettle();
      expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledWith(
        '/vault/Task.md', expect.stringContaining('status: done'), 'hash',
      );
    } finally { document.elementFromPoint = original; }
  });
});
