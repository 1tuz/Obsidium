// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

const state = vi.hoisted(() => ({
  savedView: 0,
  loadDeferred: null as Promise<number> | null,
  rows: [] as { path: string; fields: Record<string, string | number | string[]> }[],
  errors: [] as { formula: string; path: string; message: string }[],
  columns: [] as string[],
  baseContent: null as string | null,
  journalDates: [] as string[],
  resolved: {} as Record<string, string | null>,
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

vi.mock('../../modules/calendar/gateway', () => ({
  getCalendarEvents: vi.fn(async () => []),
}));

vi.mock('../../modules/links/gateway', () => ({
  resolveWikiLinks: vi.fn(async (_workspace: string, _source: string, targets: string[]) => ({
    paths: targets.map((target) => state.resolved[target] ?? null),
    complete: true,
  })),
}));

const { BaseView } = await import('./BaseView');
const { getBaseRows, queryBase } = await import('../../modules/bases/gateway');
const { saveBaseView } = await import('../../modules/ui-state/gateway');
const { createFile, writeFileAtomic } = await import('../../modules/documents/fileGateway');

interface KanbanDataTransfer {
  effectAllowed: string;
  dropEffect: string;
  setData: (format: string, value: string) => void;
  getData: (format: string) => string;
}

function kanbanDataTransfer(): KanbanDataTransfer {
  const store = new Map<string, string>();
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    setData: (format, value) => { store.set(format, value); },
    getData: (format) => store.get(format) ?? '',
  };
}

function dragEvent(type: string, dataTransfer: KanbanDataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  return event;
}

function kanbanCards(container: HTMLElement, column: string): HTMLElement[] {
  const section = [...container.querySelectorAll<HTMLElement>('[data-kanban-column]')]
    .find((item) => item.dataset.kanbanColumn === column);
  return section ? [...section.querySelectorAll<HTMLElement>('.q-base-kanban__card')] : [];
}

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
    state.resolved = {};
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
      expect.stringContaining('type: calendar'),
      'hash',
    );
    const written = vi.mocked(writeFileAtomic).mock.calls[0][1];
    expect(written.split('type: calendar')).toHaveLength(3);
    expect(written.split('dateField: due')).toHaveLength(3);
    expect(written.split('- type: ')).toHaveLength(6);
    expect(renderer!.container.querySelector('.q-base-calendar')).not.toBeNull();
  });

  it('adds a timeline view that reads the first two date properties', async () => {
    state.rows = [{
      path: '/vault/Release.md',
      fields: { start: '2026-10-01', end: '2026-10-09', owner: 'Ada' },
    }];
    const props = {
      path: '/vault/Project.base', workspacePath: '/vault', indexReady: true, indexRevision: 0,
      onOpenNote: vi.fn(),
    };
    act(() => { renderer = mountDom(<BaseView {...props} />); });
    await actAndSettle();

    const add = renderer!.container.querySelector<HTMLButtonElement>('.q-base-view__add')!;
    act(() => add.click());
    await actAndSettle();
    const timeline = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-base-view__add-menu button')]
      .find((button) => button.textContent === t('bases.viewType.timeline'))!;
    act(() => timeline.click());
    await actAndSettle();

    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledWith(
      '/vault/Project.base',
      expect.stringContaining('type: timeline'),
      'hash',
    );
    const calls = vi.mocked(writeFileAtomic).mock.calls;
    const written = calls[calls.length - 1][1];
    expect(written.split('type: timeline')).toHaveLength(2);
    expect(written).toContain('startField: start');
    expect(written).toContain('endField: end');
    expect(renderer!.container.querySelector('.q-base-timeline')).not.toBeNull();
    expect(renderer!.container.querySelectorAll('.q-base-timeline__bar')).toHaveLength(1);
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

  it('transfers a card to another Kanban column with native drag and drop', async () => {
    state.rows = [{ path: '/vault/Task.md', fields: { status: 'todo' } }];
    act(() => { renderer = mountDom(<BaseView path="/vault/Project.base" workspacePath="/vault"
      indexReady indexRevision={0} onOpenNote={vi.fn()}
      viewRequest={{ path: '/vault/Project.base', index: 1, id: 5 }} />); });
    await actAndSettle();

    const container = renderer!.container;
    expect(kanbanCards(container, 'todo').map((card) => card.textContent).join()).toContain('Task');

    let resolveWrite!: (value: { hash: string }) => void;
    vi.mocked(writeFileAtomic).mockImplementationOnce(
      () => new Promise<{ hash: string }>((resolve) => { resolveWrite = resolve; }),
    );

    const transfer = kanbanDataTransfer();
    const card = kanbanCards(container, 'todo')[0];
    const target = [...container.querySelectorAll<HTMLElement>('[data-kanban-column]')]
      .find((item) => item.dataset.kanbanColumn === 'done')!;
    act(() => { card.dispatchEvent(dragEvent('dragstart', transfer)); });
    act(() => { target.dispatchEvent(dragEvent('dragover', transfer)); });
    act(() => { target.dispatchEvent(dragEvent('drop', transfer)); });
    await actAndSettle();

    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledWith(
      '/vault/Task.md', expect.stringContaining('status: done'), 'hash',
    );
    expect(kanbanCards(container, 'done').map((item) => item.textContent).join()).toContain('Task');
    expect(kanbanCards(container, 'todo')).toHaveLength(0);

    await act(async () => { resolveWrite({ hash: 'saved' }); });
    await actAndSettle();
    expect(kanbanCards(container, 'done').map((item) => item.textContent).join()).toContain('Task');
  });

  it('rolls a dropped card back to its column when the write fails', async () => {
    state.rows = [{ path: '/vault/Task.md', fields: { status: 'todo' } }];
    act(() => { renderer = mountDom(<BaseView path="/vault/Project.base" workspacePath="/vault"
      indexReady indexRevision={0} onOpenNote={vi.fn()}
      viewRequest={{ path: '/vault/Project.base', index: 1, id: 7 }} />); });
    await actAndSettle();

    vi.mocked(writeFileAtomic).mockRejectedValueOnce(new Error('disk full'));
    const transfer = kanbanDataTransfer();
    const card = kanbanCards(renderer!.container, 'todo')[0];
    const target = [...renderer!.container.querySelectorAll<HTMLElement>('[data-kanban-column]')]
      .find((item) => item.dataset.kanbanColumn === 'done')!;
    act(() => { card.dispatchEvent(dragEvent('dragstart', transfer)); });
    act(() => { target.dispatchEvent(dragEvent('dragover', transfer)); });
    act(() => { target.dispatchEvent(dragEvent('drop', transfer)); });
    await actAndSettle();

    expect(kanbanCards(renderer!.container, 'todo').map((item) => item.textContent).join())
      .toContain('Task');
    expect(kanbanCards(renderer!.container, 'done')).toHaveLength(0);
    expect(renderer!.container.querySelector('[role="alert"]')?.textContent)
      .toBe(t('bases.kanbanMoveError', { reason: 'Error: disk full' }));
  });
});

describe('BaseView view editor', () => {
  let renderer: MountedDom | null = null;

  beforeEach(() => {
    state.savedView = 0;
    state.loadDeferred = null;
    vi.mocked(writeFileAtomic).mockReset();
    vi.mocked(writeFileAtomic).mockImplementation(async () => ({ hash: 'saved' }));
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    state.rows = [];
    state.errors = [];
    state.columns = [];
    state.baseContent = null;
    state.journalDates = [];
    state.resolved = {};
  });

  function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function choose(select: HTMLSelectElement, value: string) {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function button(label: string, container: HTMLElement): HTMLButtonElement {
    return [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((candidate) => candidate.textContent?.trim() === label)!;
  }

  async function openEditor(container: HTMLElement): Promise<HTMLElement> {
    act(() => container.querySelector<HTMLButtonElement>('.q-base-view__edit')!.click());
    await actAndSettle();
    return container.querySelector<HTMLElement>('.q-base-editor')!;
  }

  async function save(container: HTMLElement) {
    act(() => button(t('bases.editorSave'), container).click());
    await actAndSettle();
  }

  function mountBase() {
    const props = {
      path: '/vault/Project.base',
      workspacePath: '/vault',
      indexReady: true,
      indexRevision: 0,
      onOpenNote: vi.fn(),
    };
    act(() => { renderer = mountDom(<BaseView {...props} />); });
    return props;
  }

  it('renames the current view through the hash-protected writer', async () => {
    mountBase();
    await actAndSettle();

    const panel = await openEditor(renderer!.container);
    typeInto(panel.querySelector<HTMLInputElement>('.q-base-editor__name')!, 'Roadmap');
    await actAndSettle();
    await save(renderer!.container);

    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledWith(
      '/vault/Project.base',
      expect.stringContaining('name: Roadmap'),
      'hash',
    );
    expect(renderer!.container.querySelector('.q-base-editor')).toBeNull();
    expect([...renderer!.container.querySelectorAll('[role="tab"]')][0].textContent).toBe('Roadmap');

    const reopened = await openEditor(renderer!.container);
    expect(reopened.querySelector<HTMLInputElement>('.q-base-editor__name')!.value).toBe('Roadmap');
  });

  it('persists the row limit and can remove it again', async () => {
    mountBase();
    await actAndSettle();

    let panel = await openEditor(renderer!.container);
    typeInto(panel.querySelector<HTMLInputElement>('.q-base-editor__limit')!, '5');
    await actAndSettle();
    await save(renderer!.container);

    expect(vi.mocked(writeFileAtomic).mock.calls[0][1]).toContain('limit: 5');
    expect(vi.mocked(writeFileAtomic).mock.calls[0][2]).toBe('hash');

    panel = await openEditor(renderer!.container);
    expect(panel.querySelector<HTMLInputElement>('.q-base-editor__limit')!.value).toBe('5');
    typeInto(panel.querySelector<HTMLInputElement>('.q-base-editor__limit')!, '');
    await actAndSettle();
    await save(renderer!.container);

    expect(vi.mocked(writeFileAtomic).mock.calls[1][1]).not.toContain('limit:');
  });

  it('writes views[].sort from the panel and the header shows the persisted sort', async () => {
    state.columns = ['file.name', 'status'];
    state.rows = [{ path: '/vault/Task.md', fields: { status: 'todo' } }];
    mountBase();
    await actAndSettle();

    const panel = await openEditor(renderer!.container);
    choose(panel.querySelector<HTMLSelectElement>(`select[aria-label="${t('bases.editorSortAdd')}"]`)!, 'status');
    await actAndSettle();
    act(() => button(t('bases.editorSortAdd'), panel).click());
    await actAndSettle();
    expect(panel.querySelector('.q-base-editor__sort-row')).not.toBeNull();
    await save(renderer!.container);

    const written = vi.mocked(writeFileAtomic).mock.calls[0][1];
    expect(written).toContain('sort:');
    expect(written).toContain('property: status');
    expect(written).toContain('direction: ASC');

    expect(vi.mocked(queryBase)).toHaveBeenLastCalledWith('/vault', expect.objectContaining({
      sort: [{ property: 'status', direction: 'ASC' }],
    }));
    const statusHeader = [...renderer!.container.querySelectorAll<HTMLTableCellElement>('th')]
      .find((cell) => cell.textContent?.includes('status'))!;
    expect(statusHeader.querySelector('svg')).not.toBeNull();

    const reopened = await openEditor(renderer!.container);
    expect(reopened.querySelector('.q-base-editor__sort-row')?.textContent).toContain('status');
    act(() => reopened
      .querySelector<HTMLButtonElement>(`button[aria-label="${t('bases.editorSortDirection', { property: 'status' })}"]`)!
      .click());
    await actAndSettle();
    await save(renderer!.container);

    expect(vi.mocked(writeFileAtomic).mock.calls[1][1]).toContain('direction: DESC');
    expect(vi.mocked(queryBase)).toHaveBeenLastCalledWith('/vault', expect.objectContaining({
      sort: [{ property: 'status', direction: 'DESC' }],
    }));
  });

  it('persists a header sort toggle instead of keeping a shadow sort', async () => {
    state.columns = ['file.name', 'status'];
    state.rows = [{ path: '/vault/Task.md', fields: { status: 'todo' } }];
    mountBase();
    await actAndSettle();

    const statusHeader = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-base-table th button')]
      .find((candidate) => candidate.textContent?.includes('status'))!;
    act(() => statusHeader.click());
    await actAndSettle();

    expect(vi.mocked(writeFileAtomic)).toHaveBeenCalledWith(
      '/vault/Project.base',
      expect.stringContaining('property: status'),
      'hash',
    );
    expect(vi.mocked(queryBase)).toHaveBeenLastCalledWith('/vault', expect.objectContaining({
      sort: [{ property: 'status', direction: 'ASC' }],
    }));

    act(() => statusHeader.click());
    await actAndSettle();
    expect(vi.mocked(queryBase)).toHaveBeenLastCalledWith('/vault', expect.objectContaining({
      sort: [{ property: 'status', direction: 'DESC' }],
    }));
  });

  it('keeps summaries, properties and unknown keys when the panel writes', async () => {
    state.baseContent = [
      'properties:',
      '  total:',
      '    displayName: Total',
      'summaries:',
      '  - name: total',
      '    source: file.links',
      '    property: price',
      '    formula: sum',
      'legacyKey: keep-me',
      'views:',
      '  - type: table',
      '    name: Overview',
      '    groupOrder: [open, done]',
      '    customFlag: yes',
    ].join('\n');
    mountBase();
    await actAndSettle();

    const panel = await openEditor(renderer!.container);
    typeInto(panel.querySelector<HTMLInputElement>('.q-base-editor__name')!, 'Kept');
    await actAndSettle();
    await save(renderer!.container);

    const written = vi.mocked(writeFileAtomic).mock.calls[0][1];
    expect(written).toContain('summaries:');
    expect(written).toContain('name: total');
    expect(written).toContain('source: file.links');
    expect(written).toContain('displayName: Total');
    expect(written).toContain('legacyKey: keep-me');
    expect(written).toContain('customFlag: yes');
    expect(written).toContain('groupOrder: [open, done]');
    expect(written).toContain('name: Kept');
  });

  it('reports a hash conflict through the action error surface', async () => {
    mountBase();
    await actAndSettle();

    vi.mocked(writeFileAtomic).mockRejectedValueOnce(new Error('file changed on disk'));
    const panel = await openEditor(renderer!.container);
    typeInto(panel.querySelector<HTMLInputElement>('.q-base-editor__name')!, 'Conflicting');
    await actAndSettle();
    await save(renderer!.container);

    expect(renderer!.container.querySelector('[role="alert"]')?.textContent)
      .toBe('file changed on disk');
    expect(renderer!.container.querySelector('.q-base-editor')).not.toBeNull();
  });

  it('dismisses the panel with Escape without writing', async () => {
    mountBase();
    await actAndSettle();

    const panel = await openEditor(renderer!.container);
    act(() => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await actAndSettle();

    expect(renderer!.container.querySelector('.q-base-editor')).toBeNull();
    expect(vi.mocked(writeFileAtomic)).not.toHaveBeenCalled();
  });

  it('marks a property as a relation and writes properties.<key>.type', async () => {
    state.baseContent = [
      'properties:',
      '  mentor:',
      '    displayName: Наставник',
      '  status:',
      '    type: text',
      'views:',
      '  - type: table',
      '    name: Overview',
    ].join('\n');
    state.columns = ['file.name', 'mentor', 'status'];
    mountBase();
    await actAndSettle();

    const panel = await openEditor(renderer!.container);
    const control = panel.querySelector<HTMLSelectElement>(
      `select[aria-label="${t('bases.editorPropertyType', { property: 'mentor' })}"]`,
    )!;
    expect(control.value).toBe('');
    choose(control, 'relation');
    await actAndSettle();
    await save(renderer!.container);

    const written = vi.mocked(writeFileAtomic).mock.calls[0][1];
    expect(written).toContain('mentor:');
    expect(written).toContain('type: relation');
    expect(written).toContain('displayName: Наставник');
    expect(written).toContain('status:');
    expect(written.split('type: relation')).toHaveLength(2);
  });

  it('unmarks a relation property and keeps its other keys', async () => {
    state.baseContent = [
      'properties:',
      '  mentor:',
      '    displayName: Наставник',
      '    type: relation',
      'views:',
      '  - type: table',
      '    name: Overview',
    ].join('\n');
    state.columns = ['file.name', 'mentor'];
    mountBase();
    await actAndSettle();

    const panel = await openEditor(renderer!.container);
    const control = panel.querySelector<HTMLSelectElement>(
      `select[aria-label="${t('bases.editorPropertyType', { property: 'mentor' })}"]`,
    )!;
    expect(control.value).toBe('relation');
    choose(control, '');
    await actAndSettle();
    await save(renderer!.container);

    const written = vi.mocked(writeFileAtomic).mock.calls[0][1];
    expect(written).not.toContain('type: relation');
    expect(written).toContain('displayName: Наставник');
  });
});

describe('BaseView relation values', () => {
  let renderer: MountedDom | null = null;

  beforeEach(() => {
    state.savedView = 0;
    state.loadDeferred = null;
    vi.mocked(writeFileAtomic).mockReset();
    vi.mocked(writeFileAtomic).mockImplementation(async () => ({ hash: 'saved' }));
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    state.rows = [];
    state.errors = [];
    state.columns = [];
    state.baseContent = null;
    state.journalDates = [];
    state.resolved = {};
  });

  async function settleFor(container: HTMLElement, selector: string): Promise<void> {
    for (let attempt = 0; attempt < 10 && !container.querySelector(selector); attempt += 1) {
      await actAndSettle();
    }
  }

  function relationBase(secondView: string) {
    return [
      'properties:',
      '  mentor:',
      '    type: relation',
      '    displayName: Наставник',
      'views:',
      '  - type: table',
      '    name: Overview',
      `  - type: ${secondView}`,
      '    name: Second',
    ].join('\n');
  }

  it('renders a resolved relation in a table cell as a link to the note', async () => {
    state.baseContent = relationBase('table');
    state.columns = ['file.name', 'mentor'];
    state.rows = [{ path: '/vault/Task.md', fields: { mentor: '[[Ada]]' } }];
    state.resolved = { Ada: '/vault/People/Ada.md' };
    const onOpenNote = vi.fn();
    act(() => { renderer = mountDom(<BaseView path="/vault/Project.base" workspacePath="/vault"
      indexReady indexRevision={0} onOpenNote={onOpenNote} />); });
    await actAndSettle();
    await settleFor(renderer!.container, '.q-base-table td');

    const cells = renderer!.container.querySelectorAll<HTMLTableCellElement>('.q-base-table td');
    const link = cells[1].querySelector<HTMLButtonElement>('.q-base-link');
    expect(link).not.toBeNull();
    expect(link!.textContent).toContain('Ada');

    act(() => link!.click());
    expect(onOpenNote).toHaveBeenCalledWith('/vault/People/Ada.md');
  });

  it('keeps an unresolved relation value visible as plain text', async () => {
    state.baseContent = relationBase('table');
    state.columns = ['file.name', 'mentor'];
    state.rows = [{ path: '/vault/Task.md', fields: { mentor: 'Nobody' } }];
    act(() => { renderer = mountDom(<BaseView path="/vault/Project.base" workspacePath="/vault"
      indexReady indexRevision={0} onOpenNote={vi.fn()} />); });
    await actAndSettle();
    await settleFor(renderer!.container, '.q-base-table td');

    const cells = renderer!.container.querySelectorAll<HTMLTableCellElement>('.q-base-table td');
    expect(cells[1].querySelector('.q-base-link')).toBeNull();
    expect(cells[1].textContent).toBe('Nobody');
  });

  it('renders resolved and unresolved relation values on a card', async () => {
    state.baseContent = relationBase('cards');
    state.columns = ['file.name', 'mentor'];
    state.rows = [{ path: '/vault/Task.md', fields: { mentor: ['[[Ada]]', 'Nobody'] } }];
    state.resolved = { Ada: '/vault/People/Ada.md' };
    const onOpenNote = vi.fn();
    act(() => { renderer = mountDom(<BaseView path="/vault/Project.base" workspacePath="/vault"
      indexReady indexRevision={0} onOpenNote={onOpenNote}
      viewRequest={{ path: '/vault/Project.base', index: 1, id: 3 }} />); });
    await actAndSettle();
    await settleFor(renderer!.container, '.q-base-card__property');

    const property = renderer!.container.querySelector<HTMLElement>('.q-base-card__property')!;
    const link = property.querySelector<HTMLButtonElement>('.q-base-link');
    expect(link!.textContent).toContain('Ada');
    expect(property.textContent).toContain('Nobody');

    act(() => link!.click());
    expect(onOpenNote).toHaveBeenCalledWith('/vault/People/Ada.md');
  });
});
