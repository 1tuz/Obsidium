// @vitest-environment happy-dom
import { EditorView } from '@codemirror/view';
import { act } from 'preact/test-utils';
import { useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { actAndSettle, mountDom, type MountedDom } from './testing/mountDom';
import { setTheme } from './modules/theme';
import { t } from './i18n';
import type * as editorModule from './components/Editor';
import type * as settingsModule from './modules/settings';

const editorLifecycle: string[] = [];
const graphLifecycle: string[] = [];
const themeTransitionCleanups: Array<() => void> = [];
interface PendingThemeTransition {
  update: () => void | Promise<void>;
  skipTransition: ReturnType<typeof vi.fn>;
  finish: () => void;
}

function installThemeTransitions(): PendingThemeTransition[] {
  const pending: PendingThemeTransition[] = [];
  const original = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: vi.fn((update: () => void | Promise<void>) => {
      let settle: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const skipTransition = vi.fn();
      pending.push({ update, skipTransition, finish: () => settle() });
      return { finished, skipTransition };
    }),
  });
  themeTransitionCleanups.push(() => {
    pending.forEach(({ finish }) => finish());
    if (original) Object.defineProperty(document, 'startViewTransition', original);
    else Reflect.deleteProperty(document, 'startViewTransition');
  });
  return pending;
}

const workspaceState = vi.hoisted(() => ({
  files: [] as Array<{ id: string; name: string; type: 'file' }>,
  workspaceReady: false,
}));
const editorFixture = vi.hoisted(() => ({ text: null as string | null }));
const uiStateMocks = vi.hoisted(() => ({
  markDocumentMissing: vi.fn(),
  open: vi.fn(),
  queueActiveTab: vi.fn(),
  queueLayout: vi.fn(),
  queueTabsSnapshot: vi.fn(),
}));
const openerMocks = vi.hoisted(() => ({
  openPath: vi.fn(async () => undefined),
  openUrl: vi.fn(async (_url: string) => undefined),
  revealItemInDir: vi.fn(async () => undefined),
}));
const tauriMocks = vi.hoisted(() => {
  const indexStatus = {
    state: 'ready',
    updating: false,
    generation: 0,
    revision: 0,
    indexedDocuments: 0,
    scannedDocuments: 0,
  };

  return {
    invoke: vi.fn(async (command: string) => {
      if (command === 'get_spaces') return [];
      if (command === 'document_open') return { text: editorFixture.text ?? '', version: 0 };
      if (command === 'document_pull') return { kind: 'changes', changes: [] };
      if (command === 'prepare_search_index' || command === 'get_search_index_status') return indexStatus;
      return undefined;
    }),
    listen: vi.fn(async () => () => undefined),
    currentWindow: {
      label: 'main',
      setTheme: vi.fn(async () => undefined),
      onCloseRequested: vi.fn(async (_handler: (event: { preventDefault: () => void }) => Promise<void>) => () => undefined),
    },
  };
});
const settingsState = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  loadConfig: vi.fn(async () => null as Record<string, unknown> | null),
  updateConfig: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: tauriMocks.invoke,
}));

vi.mock('@tauri-apps/api/event', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/event')>()),
  listen: tauriMocks.listen,
}));

vi.mock('@tauri-apps/api/window', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/window')>()),
  getCurrentWindow: () => tauriMocks.currentWindow,
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
    activeFile,
  }: {
    onToggleRightSidebar: () => void;
    activeFile: string | null;
  }) => (
    <>
      <button id="toggle-right-sidebar" onClick={onToggleRightSidebar} />
      <span id="active-file" data-path={activeFile ?? ''} />
    </>
  ),
}));

vi.mock('@tauri-apps/plugin-opener', () => openerMocks);

vi.mock('./components/Layout/WindowControls', () => ({
  WindowControls: () => null,
}));

vi.mock('./components/Layout/SidebarRail', () => ({
  SidebarRail: ({
    onToggleSidebar,
    sections,
    activeSection,
    onSelect,
  }: {
    onToggleSidebar: () => void;
    sections: readonly string[];
    activeSection: string | null;
    onSelect: (id: string) => void;
  }) => (
    <>
      <button id="hide-left-sidebar" onClick={onToggleSidebar} />
      <span id="rail-active-section" data-active={activeSection ?? ''} />
      {sections.includes('home') ? <button id="open-home" onClick={() => onSelect('home')} /> : null}
      {sections.includes('boards') ? <button id="open-boards" onClick={() => onSelect('boards')} /> : null}
      {sections.includes('graph') ? <button id="open-graph" onClick={() => onSelect('graph')} /> : null}
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
    onToggleTheme: (origin: HTMLElement) => void;
    isOpen: boolean;
  }) => isOpen ? (
    <div id="left-sidebar">
      <button id="toggle-theme" onClick={(event) => onToggleTheme(event.currentTarget)} />
      <button id="open-a" onClick={() => onFileSelect('C:\\notes\\a.md')} />
      <button id="open-b" onClick={() => onFileSelect('C:\\notes\\b.md')} />
      <button id="open-canvas" onClick={() => onFileSelect('C:\\notes\\board.canvas')} />
      <button id="open-pdf" onClick={() => onFileSelect('C:\\notes\\manual.pdf')} />
    </div>
  ) : null,
}));

vi.mock('./components/Canvas/CanvasView', () => ({
  CanvasView: ({ onOpenFile }: { onOpenFile: (path: string) => void }) => (
    <div data-testid="canvas-toolbar" role="toolbar">
      <button id="open-note-from-canvas" onClick={() => onOpenFile('/vault/From canvas.md')} />
    </div>
  ),
}));

vi.mock('./components/Pdf/PdfViewer', () => ({
  PdfViewer: ({ path }: { path: string }) => <div data-testid="pdf-viewer" data-path={path} />,
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

vi.mock('./modules/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof settingsModule>()),
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

vi.mock('./components/Editor', async (importOriginal) => {
  const { Editor } = await importOriginal<typeof editorModule>();
  return { Editor: (props: Parameters<typeof Editor>[0]) => editorFixture.text !== null
    ? <Editor {...props} /> : <LifecycleEditor filePath={props.filePath} /> };
});

function LifecycleEditor({ filePath }: { filePath: string }) {
  useEffect(() => {
    editorLifecycle.push(`mount:${filePath}`);
    return () => {
      editorLifecycle.push(`unmount:${filePath}`);
    };
  }, []);
  return <div>{filePath}</div>;
}

function sessionStub(overrides: Record<string, unknown> = {}) {
  return {
    loaded: {
      activeTabId: null,
      layout: { kind: 'pane', paneId: 'main', activeTabId: null },
    },
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

  function prepareThemeTransition(): PendingThemeTransition[] {
    setTheme('light', 'obsidium', 'on');
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    settingsState.config = {
      editor: { liveTabs: 3 },
      updates: { auto: false },
      trash: { retentionDays: 30 },
      history: { retentionDays: 30 },
      templates: { folder: '' },
      ui: { appearance: 'light', palette: 'dracula', motion: 'on' },
    };
    return installThemeTransitions();
  }

  it('mounts without Tauri bridge errors', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await renderWithSession();
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  afterEach(async () => {
    themeTransitionCleanups.splice(0).reverse().forEach((cleanup) => cleanup());
    setTheme('light', 'obsidium', 'off');
    await Promise.resolve();
    delete document.documentElement.dataset.viewTransition;
    for (const name of [
      '--q-theme-transition-x', '--q-theme-transition-y', '--q-theme-transition-radius',
    ]) document.documentElement.style.removeProperty(name);
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    editorLifecycle.length = 0;
    graphLifecycle.length = 0;
    workspaceState.files = [];
    workspaceState.workspaceReady = false;
    settingsState.config = null;
    editorFixture.text = null;
    settingsState.loadConfig.mockReset();
    settingsState.loadConfig.mockResolvedValue(null);
    settingsState.updateConfig.mockReset();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([
    ['editing', 'https://Example.TEST/a%2Fb?tag=One%2BTwo#Section', true],
    ['reading', 'http://Example.TEST/a%2Fb?tag=One%2BTwo#Section', true],
    ['reading', 'mailto:Reader@Example.TEST?subject=One%20Two', true],
    ['editing', 'custom-app://Example.TEST/section', false],
  ])('routes %s link %s according to the external opener policy without adding a Browser tab', async (mode, url, allowed) => {
    editorFixture.text = `# Note\n\n[Visit](${url})\n`;
    await renderWithSession();
    await actAndSettle(() => find('open-a')[0].click());
    if (mode === 'reading') {
      const modeButton = renderer!.container.querySelector<HTMLButtonElement>(`[aria-label="${t('editor.editingMode')}"]`)!;
      await actAndSettle(() => modeButton.click());
    }

    const link = renderer!.container.querySelector<HTMLElement>('.cm-content .q-md-link')!;
    const view = EditorView.findFromDOM(link.closest<HTMLElement>('.cm-editor')!)!;
    expect(view.state.readOnly).toBe(mode === 'reading');
    const hitTest = vi.spyOn(view, 'posAtCoords').mockReturnValue(view.state.doc.toString().indexOf('Visit') + 2);
    try {
      await actAndSettle(() => {
        link.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      });
    } finally {
      hitTest.mockRestore();
    }

    if (allowed) expect(openerMocks.openUrl).toHaveBeenCalledExactlyOnceWith(url);
    else expect(openerMocks.openUrl).not.toHaveBeenCalled();
    expect(attribute('active-file', 'data-path')).toBe('C:\\notes\\a.md');
    expect(renderer!.container.querySelector('.q-web-page-pane')).toBeNull();
    expect(uiStateMocks.queueTabsSnapshot.mock.calls.flatMap(([tabs]) => tabs)).not.toContainEqual(
      expect.objectContaining({ kind: 'web' }),
    );
  });

  it('keeps the editor area empty until the workspace session is restored', () => {
    act(() => {
      renderer = mountDom(<App />);
    });

    expect(find('open-file-from-new-tab')).toHaveLength(0);
    expect(editorLifecycle).toHaveLength(0);
  });

  it('returns from a note opened on the canvas back to the canvas', async () => {
    await renderWithSession();

    click('open-canvas');
    await actAndSettle();
    expect(attribute('active-file', 'data-path')).toBe('C:\\notes\\board.canvas');

    click('open-note-from-canvas');
    await actAndSettle();
    expect(attribute('active-file', 'data-path')).toBe('/vault/From canvas.md');

    const back = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label') === t('editor.back'))!;
    act(() => back.click());
    await actAndSettle();
    expect(attribute('active-file', 'data-path')).toBe('C:\\notes\\board.canvas');
  });

  it('keeps the quick theme switch in the sidebar while settings are loading', () => {
    act(() => {
      renderer = mountDom(<App />);
    });

    expect(find('toggle-theme')).toHaveLength(1);
  });

  it('hides the Home action when no home page resolves', async () => {
    await renderWithSession();

    expect(find('open-home')).toHaveLength(0);
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

  it('shows the active Canvas board and toolbar in the editor area', async () => {
    await renderWithSession();

    await actAndSettle(() => find('open-canvas')[0].click());

    const toolbar = renderer!.container.querySelector('[data-testid="canvas-toolbar"]');
    expect(toolbar).not.toBeNull();
    expect(renderer!.container.querySelectorAll('[data-testid="canvas-toolbar"]')).toHaveLength(1);
    expect(toolbar?.closest('main')?.classList.contains('q-offstage')).toBe(false);
  });

  it('opens a PDF in the active tab instead of sending it to the external opener', async () => {
    workspaceState.files = [{ id: 'C:\\notes\\manual.pdf', name: 'manual.pdf', type: 'file' }];
    await renderWithSession();

    await actAndSettle(() => find('open-pdf')[0].click());

    expect(find('active-file')[0].getAttribute('data-path')).toBe('C:\\notes\\manual.pdf');
    expect(renderer!.container.querySelector('[data-testid="pdf-viewer"]')?.getAttribute('data-path'))
      .toBe('C:\\notes\\manual.pdf');
    expect(openerMocks.openPath).not.toHaveBeenCalled();
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

  it('does not wait for settings persistence before completing the theme transition update', async () => {
    const transitions = prepareThemeTransition();
    settingsState.updateConfig.mockReturnValue(new Promise<void>(() => undefined));
    await renderWithSession();

    click('toggle-theme');
    const result = transitions[0]!.update();
    let completed = false;
    void Promise.resolve(result).then(() => { completed = true; });
    await Promise.resolve();
    await Promise.resolve();

    expect(completed).toBe(true);
    expect(settingsState.updateConfig).toHaveBeenCalledOnce();

    transitions[0]!.finish();
    await Promise.resolve();
  });

  it('logs a rejected theme save without rejecting the transition update', async () => {
    const transitions = prepareThemeTransition();
    const error = new Error('save failed');
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    settingsState.updateConfig.mockRejectedValue(error);
    await renderWithSession();

    click('toggle-theme');
    await expect(transitions[0]!.update()).resolves.toBeUndefined();
    await Promise.resolve();

    expect(report).toHaveBeenCalledWith('Failed to switch theme', error);
    transitions[0]!.finish();
    await Promise.resolve();
  });

  it('keeps rapid theme toggles ordered and cleans only the finished transition', async () => {
    const transitions = prepareThemeTransition();
    settingsState.updateConfig.mockImplementation((nextConfig: { ui: { appearance: 'light' | 'dark' } }) => {
      setTheme(nextConfig.ui.appearance, 'obsidium', 'on');
      return new Promise<void>(() => undefined);
    });
    await renderWithSession();

    click('toggle-theme');
    act(() => { transitions[0]!.update(); });
    click('toggle-theme');
    act(() => { transitions[1]!.update(); });

    expect(settingsState.updateConfig.mock.calls.map(([config]) => (config as { ui: { appearance: string } }).ui.appearance))
      .toEqual(['dark', 'light']);
    expect(transitions[0]!.skipTransition).toHaveBeenCalledOnce();

    transitions[0]!.finish();
    await Promise.resolve();
    expect(document.documentElement.dataset.viewTransition).toBe('theme');
    transitions[1]!.finish();
    await Promise.resolve();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
    expect(document.documentElement.style.getPropertyValue('--q-theme-transition-x')).toBe('');
  });

  it('applies two theme toggles requested before either transition callback runs', async () => {
    const transitions = prepareThemeTransition();
    settingsState.updateConfig.mockImplementation((nextConfig: { ui: { appearance: 'light' | 'dark'; palette: string; motion: 'on' } }) => {
      setTheme(nextConfig.ui.appearance, nextConfig.ui.palette, nextConfig.ui.motion);
      return Promise.resolve();
    });
    await renderWithSession();

    click('toggle-theme');
    click('toggle-theme');
    expect(transitions).toHaveLength(2);
    let updateResult: void | Promise<void>;
    act(() => { updateResult = transitions[1]!.update(); });
    await updateResult!;

    expect(settingsState.updateConfig.mock.calls.map(([config]) => config))
      .toEqual([
        expect.objectContaining({
          editor: { liveTabs: 3 },
          templates: { folder: '' },
          ui: expect.objectContaining({ appearance: 'dark', palette: 'dracula', motion: 'on' }),
        }),
        expect.objectContaining({
          editor: { liveTabs: 3 },
          templates: { folder: '' },
          ui: expect.objectContaining({ appearance: 'light', palette: 'dracula', motion: 'on' }),
        }),
      ]);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.palette).toBe('dracula');
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

describe('window close', () => {
  let renderer: MountedDom | null = null;

  type CloseHandler = (event: { preventDefault: () => void }) => Promise<void>;
  let handler: CloseHandler | null = null;

  async function renderApp(): Promise<CloseHandler> {
    workspaceState.workspaceReady = true;
    uiStateMocks.open.mockResolvedValue(sessionStub());
    tauriMocks.currentWindow.onCloseRequested.mockImplementation(async (received) => {
      handler = received;
      return () => undefined;
    });
    await actAndSettle(() => {
      renderer = mountDom(<App />);
    });
    if (!handler) throw new Error('close handler was not registered');
    return handler;
  }

  afterEach(() => {
    if (renderer) {
      act(() => renderer?.unmount());
      renderer = null;
    }
    workspaceState.workspaceReady = false;
    handler = null;
    vi.clearAllMocks();
  });

  it('lets the window close when the documents flush succeeds', async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_spaces') return [];
      return undefined;
    });
    const close = await renderApp();
    const event = { preventDefault: vi.fn() };

    await close(event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('vetoes the close when saving a document fails', async () => {
    tauriMocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'get_spaces') return [];
      if (command === 'document_flush_all') {
        throw { code: 'io', details: { message: 'диск недоступен' } };
      }
      return undefined;
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const close = await renderApp();
      const event = { preventDefault: vi.fn() };

      await close(event);

      expect(event.preventDefault).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
