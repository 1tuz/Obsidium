import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

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
  queueTabsSnapshot: vi.fn(),
}));
let keydownHandler: ((event: KeyboardEvent) => void) | null = null;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal('window', {
  addEventListener: vi.fn((type: string, listener: (event: KeyboardEvent) => void) => {
    if (type === 'keydown') keydownHandler = listener;
  }),
  removeEventListener: vi.fn((type: string, listener: (event: KeyboardEvent) => void) => {
    if (type === 'keydown' && keydownHandler === listener) keydownHandler = null;
  }),
});

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

vi.mock('./modules/windowReveal', () => ({
  revealAppWindow: vi.fn(() => Promise.resolve()),
}));

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
  }: {
    onToggleSidebar: () => void;
    onOpenGraph: () => void;
  }) => (
    <>
      <button id="hide-left-sidebar" onClick={onToggleSidebar} />
      <button id="open-graph" onClick={onOpenGraph} />
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
    isOpen,
  }: {
    onFileSelect: (path: string) => void;
    isOpen: boolean;
  }) => isOpen ? (
    <div id="left-sidebar">
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
  useSettingsStore: () => ({
    config: null,
    isLoading: false,
    error: null,
    loadConfig: () => Promise.resolve(),
    updateConfig: vi.fn(),
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
  let renderer: ReactTestRenderer | null = null;

  async function renderWithSession(node = <App />): Promise<ReactTestRenderer> {
    workspaceState.workspaceReady = true;
    uiStateMocks.open.mockResolvedValue(sessionStub());
    await act(async () => {
      renderer = create(node);
      await Promise.resolve();
      await Promise.resolve();
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
    keydownHandler = null;
    vi.clearAllMocks();
  });

  it('keeps the editor area empty until the workspace session is restored', () => {
    act(() => {
      renderer = create(<App />);
    });

    expect(renderer?.root.findAllByProps({ id: 'open-file-from-new-tab' })).toHaveLength(0);
    expect(editorLifecycle).toHaveLength(0);
  });

  it('creates a fresh editor instance when a sidebar selection replaces the active file', async () => {
    await renderWithSession(<StrictMode><App /></StrictMode>);

    act(() => renderer?.root.findByProps({ id: 'open-a' }).props.onClick());
    act(() => renderer?.root.findByProps({ id: 'open-b' }).props.onClick());

    const unmountedA = editorLifecycle.lastIndexOf('unmount:C:\\notes\\a.md');
    const mountedB = editorLifecycle.lastIndexOf('mount:C:\\notes\\b.md');
    expect(unmountedA).toBeGreaterThanOrEqual(0);
    expect(mountedB).toBeGreaterThan(unmountedA);
  });

  it('keeps the graph mounted and merely hidden while another tab is active', async () => {
    await renderWithSession();

    act(() => renderer?.root.findByProps({ id: 'open-a' }).props.onClick());
    act(() => renderer?.root.findByProps({ id: 'open-graph' }).props.onClick());
    expect(graphLifecycle).toEqual(['mount']);
    expect(renderer?.root.findByProps({ id: 'graph' }).props['data-inactive']).toBe(false);

    act(() => renderer?.root.findByProps({ id: 'open-a' }).props.onClick());
    expect(graphLifecycle).toEqual(['mount']);
    expect(renderer?.root.findByProps({ id: 'graph' }).props['data-inactive']).toBe(true);

    act(() => renderer?.root.findByProps({ id: 'open-graph' }).props.onClick());
    expect(graphLifecycle).toEqual(['mount']);
    expect(renderer?.root.findByProps({ id: 'graph' }).props['data-inactive']).toBe(false);
  });

  it('opens global search with the physical Ctrl+O shortcut', () => {
    act(() => {
      renderer = create(<App />);
    });
    const preventDefault = vi.fn();

    act(() => keydownHandler?.({
      code: 'KeyO',
      key: 'щ',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      preventDefault,
    } as unknown as KeyboardEvent));

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(renderer?.root.findByProps({ id: 'search-dialog' }).props['data-open']).toBe(true);
  });

  it('opens search from a new tab', async () => {
    await renderWithSession();

    act(() => renderer?.root.findByProps({ id: 'open-file-from-new-tab' }).props.onClick());

    expect(renderer?.root.findByProps({ id: 'search-dialog' }).props['data-open']).toBe(true);
  });

  it('hides and restores both sidebars', () => {
    act(() => {
      renderer = create(<App />);
    });
    const root = renderer!.root;

    expect(root.findAllByProps({ id: 'left-sidebar' })).toHaveLength(1);
    expect(root.findAllByProps({ id: 'right-sidebar' })).toHaveLength(1);

    act(() => root.findByProps({ id: 'hide-left-sidebar' }).props.onClick());
    expect(root.findAllByProps({ id: 'left-sidebar' })).toHaveLength(0);

    act(() => root.findByProps({ id: 'hide-left-sidebar' }).props.onClick());
    expect(root.findAllByProps({ id: 'left-sidebar' })).toHaveLength(1);

    act(() => root.findByProps({ id: 'toggle-right-sidebar' }).props.onClick());
    expect(root.findAllByProps({ id: 'right-sidebar' })).toHaveLength(0);

    act(() => root.findByProps({ id: 'toggle-right-sidebar' }).props.onClick());
    expect(root.findAllByProps({ id: 'right-sidebar' })).toHaveLength(1);
  });

  it('restores an existing tab and rejects a missing active tab', async () => {
    workspaceState.workspaceReady = true;
    workspaceState.files = [{ id: 'C:\\notes\\kept.md', name: 'kept.md', type: 'file' }];
    uiStateMocks.markDocumentMissing.mockResolvedValue(undefined);
    uiStateMocks.open.mockResolvedValue({
      loaded: { activeTabId: 'missing-tab' },
      restoredTabs: () => [
        { tabId: 'kept-tab', documentId: 'kept-doc', kind: 'document', path: 'C:\\notes\\kept.md' },
        { tabId: 'missing-tab', documentId: 'missing-doc', kind: 'document', path: 'C:\\notes\\missing.md' },
      ],
      markDocumentMissing: uiStateMocks.markDocumentMissing,
      queueActiveTab: uiStateMocks.queueActiveTab,
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

    await act(async () => {
      renderer = create(<App />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(editorLifecycle[editorLifecycle.length - 1]).toBe('mount:C:\\notes\\kept.md');
    expect(uiStateMocks.markDocumentMissing).toHaveBeenCalledWith('missing-doc');
    expect(uiStateMocks.queueTabsSnapshot).toHaveBeenLastCalledWith(
      [expect.objectContaining({ tabId: 'kept-tab' })],
      'kept-tab',
    );
  });
});
