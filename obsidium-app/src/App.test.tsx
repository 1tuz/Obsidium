// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { actAndSettle, mountDom, type MountedDom } from './testing/mountDom';
import { setTheme } from './modules/theme';

const editorLifecycle: string[] = [];
const graphLifecycle: string[] = [];
const workspaceState = vi.hoisted(() => ({
  files: [] as Array<{ id: string; name: string; type: 'file' }>,
  workspaceReady: false,
}));
const uiStateMocks = vi.hoisted(() => ({
  markDocumentMissing: vi.fn(),
  open: vi.fn(),
  queueActiveTab: vi.fn(),
  queueLayout: vi.fn(),
  queueTabsSnapshot: vi.fn(),
}));
const settingsState = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loadConfig: vi.fn(async () => null as Record<string, unknown> | null),
  updateConfig: vi.fn(),
}));

vi.mock('./hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    directories: new Map(),
    files: workspaceState.files,
    loadingDirectories: new Set(),
    workspacePath: 'C:\\notes',
    workspaceName: 'notes',
    workspaceReady: workspaceState.workspaceReady,
    workspaceRestoring: false,
    homePage: '',
    changeHomePage: vi.fn(),
    openWorkspace: vi.fn(),
    loadDirectory: vi.fn(),
    patchFileInTree: vi.fn(),
  }),
}));

vi.mock('./modules/documents/fileGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./modules/documents/fileGateway')>();
  return {
    ...actual,
    existingFiles: async (paths: string[]) => {
      const available = new Set(workspaceState.files.map((file) => file.id));
      return paths.filter((path) => available.has(path));
    },
  };
});

vi.mock('./modules/ui-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./modules/ui-state')>();
  return {
    ...actual,
    WorkspaceSession: {
      open: uiStateMocks.open,
      restorable: actual.WorkspaceSession.restorable,
    },
  };
});

vi.mock('./components/Layout/Titlebar', () => ({
  Titlebar: ({
    onToggleRightSidebar,
  }: {
    onToggleRightSidebar: () => void;
  }) => (
    <>
      <button id="toggle-right-sidebar" onClick={onToggleRightSidebar} />
    </>
  ),
}));

vi.mock('./components/Layout/WindowControls', () => ({
  WindowControls: () => null,
}));

vi.mock('./components/Layout/SidebarRail', () => ({
  SidebarRail: ({
    onToggleSidebar,
    onOpenGraph,
    onOpenBoards,
  }: {
    onToggleSidebar: () => void;
    onOpenGraph: () => void;
    onOpenBoards?: () => void;
  }) => (
    <>
      <button id="hide-left-sidebar" onClick={onToggleSidebar} />
      <button id="open-graph" onClick={onOpenGraph} />
      {onOpenBoards ? <button id="open-boards" onClick={onOpenBoards} /> : null}
    </>
  ),
}));

vi.mock('./components/Graph/GraphView', () => ({
  GraphView: ({ inactive }: { inactive: boolean }) => {
    useEffect(() => {
      graphLifecycle.push('mount');
      return () => {
        graphLifecycle.push('unmount');
      };
    }, []);
    return <div id="graph" data-inactive={inactive} />;
  },
}));

vi.mock('./components/Layout/Sidebar', () => ({
  Sidebar: ({
    onFileSelect,
    onToggleTheme,
    isOpen,
  }: {
    onFileSelect: (path: string) => void;
    onToggleTheme: () => void;
    isOpen: boolean;
  }) => isOpen ? (
    <div id="left-sidebar">
      <button id="toggle-theme" onClick={onToggleTheme} />
      <button id="open-a" onClick={() => onFileSelect('C:\\notes\\a.md')} />
      <button id="open-b" onClick={() => onFileSelect('C:\\notes\\b.md')} />
    </div>
  ) : null,
}));

vi.mock('./components/Editor/NewTab', () => ({
  NewTab: ({ onOpen }: { onOpen: () => void }) => (
    <button id="open-file-from-new-tab" onClick={onOpen} />
  ),
}));

vi.mock('./components/Search/SearchDialog', () => ({
  SearchDialog: ({ open }: { open: boolean }) => <div id="search-dialog" data-open={open} />,
}));

vi.mock('./components/Settings/SettingsDialog', () => ({
  SettingsDialog: ({ open }: { open: boolean }) => <div id="settings-dialog" data-open={open} />,
}));

vi.mock('./modules/settings', () => ({
  DEFAULT_LIVE_TABS: 3,
  DEFAULT_BUILTINS: { editingToolbar: false, kanban: true, panes: false, toolbarPosition: 'top' },
  useSettingsStore: () => ({
    config: settingsState.config,
    isLoading: false,
    error: null,
    loadConfig: settingsState.loadConfig,
    updateConfig: settingsState.updateConfig,
  }),
}));

vi.mock('./components/Backlinks/BacklinksPanel', () => ({
  BacklinksPanel: ({ isOpen }: { isOpen: boolean }) => isOpen ? <div id="right-sidebar" /> : null,
}));

vi.mock('./components/Common/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('./components/Editor', () => ({
  Editor: ({ filePath }: { filePath: string }) => {
    useEffect(() => {
      editorLifecycle.push(`mount:${filePath}`);
      return () => {
        editorLifecycle.push(`unmount:${filePath}`);
      };
    }, []);
    return <div>{filePath}</div>;
  },
}));

function sessionStub(overrides: Record<string, unknown> = {}) {
  return {
    loaded: { activeTabId: null },
    restoredTabs: () => [],
    markDocumentMissing: uiStateMocks.markDocumentMissing,
    queueActiveTab: uiStateMocks.queueActiveTab,
    queueLayout: uiStateMocks.queueLayout,
    queueTabsSnapshot: uiStateMocks.queueTabsSnapshot,
    queueView: vi.fn(),
    loadedView: vi.fn(() => null),
    isViewLoaded: vi.fn(() => true),
    graphCamera: vi.fn(() => null),
    queueGraphCamera: vi.fn(),
    ensureViewLoaded: vi.fn(async () => null),
    resolveDocument: vi.fn(async (path: string) => `doc:${path}`),
    renameDocument: vi.fn(),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe('App editor lifecycle', () => {
  let renderer: MountedDom | null = null;

  const find = (id: string) => renderer!.container.querySelectorAll<HTMLElement>(`#${id}`);
  const attribute = (id: string, name: string) => find(id)[0]?.getAttribute(name);
  const click = (id: string) => act(() => find(id)[0].click());

  async function renderWithSession(node = <App />): Promise<MountedDom> {
    workspaceState.workspaceReady = true;
    uiStateMocks.open.mockResolvedValue(sessionStub());
    await actAndSettle(() => {
      renderer = mountDom(node);
    });
    return renderer!;
  }

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    editorLifecycle.length = 0;
    graphLifecycle.length = 0;
    workspaceState.files = [];
    workspaceState.workspaceReady = false;
    settingsState.config = null;
    settingsState.loadConfig.mockReset();
    settingsState.loadConfig.mockResolvedValue(null);
    settingsState.updateConfig.mockReset();
    vi.clearAllMocks();
  });

  it('keeps the editor area empty until the workspace session is restored', () => {
    act(() => {
      renderer = mountDom(<App />);
    });

    expect(find('open-file-from-new-tab')).toHaveLength(0);
    expect(editorLifecycle).toHaveLength(0);
  });

  it('keeps the quick theme switch in the sidebar while settings are loading', () => {
    act(() => {
      renderer = mountDom(<App />);
    });

    expect(find('toggle-theme')).toHaveLength(1);
  });

  it('shows the Boards entry only when the Kanban built-in is enabled', async () => {
    settingsState.config = {
      editor: { liveTabs: 3 },
      updates: { auto: false },
      trash: { retentionDays: 30 },
      history: { retentionDays: 30 },
      templates: { folder: '' },
      ui: { appearance: 'system', palette: 'obsidium', motion: 'system', language: 'ru', enabledSnippets: {} },
      builtins: { editingToolbar: true, kanban: false, toolbarPosition: 'top' },
    };
    await renderWithSession();
    expect(find('open-boards')).toHaveLength(0);

    settingsState.config = {
      ...settingsState.config,
      builtins: { editingToolbar: true, kanban: true, toolbarPosition: 'top' },
    };
    await actAndSettle(() => renderer!.update(<App />));
    expect(find('open-boards')).toHaveLength(1);
  });

  it('loads settings and switches theme when clicked before config is ready', async () => {
    const config = {
      editor: { liveTabs: 3 },
      updates: { auto: false },
      trash: { retentionDays: 30 },
      history: { retentionDays: 30 },
      templates: { folder: '' },
      ui: { appearance: 'system', palette: 'obsidium', motion: 'system' },
    };
    settingsState.loadConfig.mockResolvedValue(config);
    settingsState.updateConfig.mockResolvedValue(undefined);
    setTheme('dark', 'obsidium');
    await renderWithSession();

    await actAndSettle(() => find('toggle-theme')[0].click());

    expect(settingsState.loadConfig).toHaveBeenCalled();
    expect(settingsState.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      ui: { appearance: 'light', palette: 'obsidium', motion: 'system' },
    }));
  });

  it('creates a fresh editor instance when a sidebar selection replaces the active file', async () => {
    await renderWithSession();

    click('open-a');
    click('open-b');

    const unmountedA = editorLifecycle.lastIndexOf('unmount:C:\\notes\\a.md');
    const mountedB = editorLifecycle.lastIndexOf('mount:C:\\notes\\b.md');
    expect(unmountedA).toBeGreaterThanOrEqual(0);
    expect(mountedB).toBeGreaterThan(unmountedA);
  });

  it('keeps the graph mounted and merely hidden while another tab is active', async () => {
    await renderWithSession();

    click('open-a');
    await actAndSettle(() => find('open-graph')[0].click());
    expect(graphLifecycle).toEqual(['mount']);
    expect(attribute('graph', 'data-inactive')).toBe('false');

    click('open-a');
    expect(graphLifecycle).toEqual(['mount']);
    expect(attribute('graph', 'data-inactive')).toBe('true');

    click('open-graph');
    expect(graphLifecycle).toEqual(['mount']);
    expect(attribute('graph', 'data-inactive')).toBe('false');
  });

  it('opens global search with the physical Ctrl+O shortcut', () => {
    act(() => {
      renderer = mountDom(<App />);
    });
    const shortcut = new KeyboardEvent('keydown', {
      code: 'KeyO',
      key: 'щ',
      ctrlKey: true,
      cancelable: true,
    });

    act(() => {
      window.dispatchEvent(shortcut);
    });

    expect(shortcut.defaultPrevented).toBe(true);
    expect(attribute('search-dialog', 'data-open')).toBe('true');
  });

  it('opens search from a new tab', async () => {
    await renderWithSession();

    click('open-file-from-new-tab');

    expect(attribute('search-dialog', 'data-open')).toBe('true');
  });

  it('hides and restores both sidebars', () => {
    act(() => {
      renderer = mountDom(<App />);
    });

    expect(find('left-sidebar')).toHaveLength(1);
    expect(find('right-sidebar')).toHaveLength(1);

    click('hide-left-sidebar');
    expect(find('left-sidebar')).toHaveLength(0);

    click('hide-left-sidebar');
    expect(find('left-sidebar')).toHaveLength(1);

    click('toggle-right-sidebar');
    expect(find('right-sidebar')).toHaveLength(0);

    click('toggle-right-sidebar');
    expect(find('right-sidebar')).toHaveLength(1);
  });

  it('switches the stored appearance from the sidebar footer', async () => {
    setTheme('light', 'obsidium');
    settingsState.config = {
      editor: { liveTabs: 3 },
      updates: { auto: false },
      trash: { retentionDays: 30 },
      history: { retentionDays: 30 },
      templates: { folder: '' },
      ui: { appearance: 'system', palette: 'dracula', motion: 'system' },
    };
    settingsState.updateConfig.mockResolvedValue(undefined);
    await renderWithSession();

    click('toggle-theme');

    expect(settingsState.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      ui: { appearance: 'dark', palette: 'dracula', motion: 'system' },
    }));
  });

  it('restores an existing tab and rejects a missing active tab', async () => {
    workspaceState.workspaceReady = true;
    workspaceState.files = [{ id: 'C:\\notes\\kept.md', name: 'kept.md', type: 'file' }];
    uiStateMocks.markDocumentMissing.mockResolvedValue(undefined);
    uiStateMocks.open.mockResolvedValue({
      loaded: {
        activeTabId: 'missing-tab',
        layout: { kind: 'pane', paneId: 'main', activeTabId: 'missing-tab' },
      },
      restoredTabs: () => [
        { tabId: 'kept-tab', documentId: 'kept-doc', kind: 'document', path: 'C:\\notes\\kept.md', paneId: 'main' },
        { tabId: 'missing-tab', documentId: 'missing-doc', kind: 'document', path: 'C:\\notes\\missing.md', paneId: 'main' },
      ],
      markDocumentMissing: uiStateMocks.markDocumentMissing,
      queueActiveTab: uiStateMocks.queueActiveTab,
      queueLayout: uiStateMocks.queueLayout,
      queueTabsSnapshot: uiStateMocks.queueTabsSnapshot,
      queueView: vi.fn(),
      loadedView: vi.fn(() => null),
      isViewLoaded: vi.fn(() => true),
      graphCamera: vi.fn(() => null),
      queueGraphCamera: vi.fn(),
      ensureViewLoaded: vi.fn(async () => null),
      resolveDocument: vi.fn(),
      renameDocument: vi.fn(),
      dispose: vi.fn(),
    });

    await actAndSettle(() => {
      renderer = mountDom(<App />);
    });

    expect(editorLifecycle[editorLifecycle.length - 1]).toBe('mount:C:\\notes\\kept.md');
    expect(uiStateMocks.markDocumentMissing).toHaveBeenCalledWith('missing-doc');
    expect(uiStateMocks.queueTabsSnapshot).toHaveBeenLastCalledWith(
      [expect.objectContaining({ tabId: 'kept-tab' })],
      'kept-tab',
      expect.objectContaining({ kind: 'pane', paneId: 'main' }),
    );
  });
});
