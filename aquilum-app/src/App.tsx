import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorPane } from "./components/Editor/EditorPane";
import { Titlebar } from "./components/Layout/Titlebar";
import { PaneLayoutView } from "./components/Layout/PaneLayoutView";
import { WindowControls } from "./components/Layout/WindowControls";
import { Sidebar } from "./components/Layout/Sidebar";
import { SidebarRail } from "./components/Layout/SidebarRail";
import { UpdateSplash } from "./components/Common/UpdateSplash";
import { DeleteNotesDialog } from "./components/Common/DeleteNotesDialog";
import { useFileTreeActions } from "./components/Layout/useFileTreeActions";
import { NewTab } from "./components/Editor/NewTab";
import { WorkspaceEmptyState } from "./components/Workspace/WorkspaceEmptyState";
import { SearchDialog } from "./components/Search/SearchDialog";
import { TemplateDialog } from "./components/Templates/TemplateDialog";
import { WorkspaceDialog } from "./components/Workspace/WorkspaceDialog";
import { BacklinksPanel } from "./components/Backlinks/BacklinksPanel";
import { useWorkspace } from "./hooks/useWorkspace";
import { useTabs } from "./hooks/useTabs";
import { useNavigationHistory } from "./hooks/useNavigationHistory";
import { useLiveTabs } from "./hooks/useLiveTabs";
import { useLocalState } from "./modules/workspace/uiPersist";
import { matchesShortcut, SHORTCUTS } from "./config/shortcuts";
import { openExternalUrl } from "./modules/openExternalUrl";
import { beginOpenTrace } from "./modules/perf/openTrace";
import { markBootStage } from "./modules/perf/bootTrace";
import type { SearchResult } from "./modules/search";
import type { AnalysisResult } from "./modules/analysis";
import {
  resolveWikiLinks,
  useLinkIndex,
  type Backlink,
  type LinkDisposition,
  type OutgoingLink,
} from "./modules/links";
import { DEFAULT_BUILTINS, DEFAULT_LIVE_TABS, useSettingsStore } from "./modules/settings";
import { installUpdateOnStartup } from "./modules/updates";
import { resolveLocale, t } from "./i18n";
import { useActiveNoteReport, useMcpNavigation } from "./modules/mcp";
import { isBasePath, isCanvasPath, isMarkdownPath } from "./modules/documents/fileGateway";
import { fileStem } from "./modules/paths";
import { useNoteRelocation } from "./modules/documents/useNoteRelocation";
import { readTemplate, type NoteTemplate } from "./modules/templates";
import { keepVersionsOf } from "./modules/history";
import { useRetentionCleanup } from "./hooks/useRetentionCleanup";
import { applyVaultSnippets } from "./modules/docs/vaultSnippets";
import { flushDocuments } from "./modules/documents/documentGateway";
import { useWindowDocumentSync } from "./modules/documents/useWindowDocumentSync";
import { applyTemplateToDocument } from "./components/Editor/docMutations";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTauriSubscription } from "./hooks/useTauriEvent";
import { useOverlay } from "./hooks/useOverlay";
import { useThemeMode } from "./hooks/useThemeMode";
import { CommandRegistry } from "./modules/commands/registry";
import type { BoardActionRequest } from "./components/Layout/BoardsPanel";
import { paneLeaves } from "./modules/panes/layout";
import "./App.css";

const GraphView = lazy(() => import("./components/Graph/GraphView")
  .then((module) => ({ default: module.GraphView })));
const SettingsDialog = lazy(() => import("./components/Settings/SettingsDialog")
  .then((module) => ({ default: module.SettingsDialog })));
const CommandPalette = lazy(() => import("./components/Commands/CommandPalette")
  .then((module) => ({ default: module.CommandPalette })));
const BaseView = lazy(() => import("./components/Bases/BaseView")
  .then((module) => ({ default: module.BaseView })));
const CanvasView = lazy(() => import("./components/Canvas/CanvasView")
  .then((module) => ({ default: module.CanvasView })));

export default function App() {
  const search = useOverlay();
  const commandPalette = useOverlay();
  const templates = useOverlay();
  const settings = useOverlay();
  const workspaces = useOverlay();
  const [leftSidebarOpen, setLeftSidebarOpen] = useLocalState('aquilum_sidebar_left_open', true);
  const [rightSidebarOpen, setRightSidebarOpen] = useLocalState('aquilum_sidebar_right_open', true);
  const [focusMode, setFocusMode] = useLocalState('aquilum_focus_mode', false);
  const toggleFocusMode = useCallback(() => {
    setFocusMode((current) => !current);
  }, []);
  const leftSidebarVisible = leftSidebarOpen && !focusMode;
  const rightSidebarVisible = rightSidebarOpen && !focusMode;
  const [searchReveal, setSearchReveal] = useState<{
    path: string;
    paneId: string;
    offset: number;
    nonce: string;
  } | null>(null);
  const [homePagePath, setHomePagePath] = useState<string | null>(null);
  const [sidebarPanel, setSidebarPanel] = useState<'files' | 'boards'>('files');
  const [boardActionRequest, setBoardActionRequest] = useState<BoardActionRequest | null>(null);
  const [createBoardRequest, setCreateBoardRequest] = useState(0);
  const [baseViewRequest, setBaseViewRequest] = useState<{ path: string; index: number; id: number; paneId: string } | null>(null);
  const boardRequestId = useRef(0);
  const {
    files,
    directories,
    loadingDirectories,
    workspacePath,
    workspaceName,
    workspaceReady,
    workspaceRestoring,
    openFailedPath,
    homePage: workspaceHomePage,
    changeHomePage,
    openWorkspace,
    loadDirectory,
    patchFileInTree,
  } = useWorkspace();
  const {
    ensureReady: ensureLinksReady,
    ready: linkIndexReady,
    revision: linkIndexRevision,
  } = useLinkIndex(workspacePath);
  const {
    tabs,
    activeFile,
    activeTabId,
    activePaneId,
    layout,
    sessionReady,
    viewRevision,
    stateError,
    loadedView,
    isViewLoaded,
    onViewStateChange,
    activateFile,
    closeTab,
    newTab,
    reorderTabs,
    splitPane,
    moveTab,
    removePane,
    resizePane,
    focusPane,
    selectTab,
    openGraph,
    readGraphCamera,
    onGraphCameraChange,
    createNewFile,
    createFromTemplate,
    createCanvas,
    createLinkedFile,
    handleExternalRename
  } = useTabs(workspacePath, workspaceReady);
  const activeTab = tabs.find((tab) => tab.tabId === activeTabId) ?? null;
  const {
    push,
    go,
    canGoBack,
    canGoForward,
  } = useNavigationHistory(workspacePath);

  const { config, loadConfig, updateConfig } = useSettingsStore();
  const kanbanEnabled = config?.builtins?.kanban ?? DEFAULT_BUILTINS.kanban;
  const panesEnabled = config?.builtins?.panes ?? DEFAULT_BUILTINS.panes;
  const themeMode = useThemeMode();
  const toggleTheme = useCallback(async () => {
    const currentConfig = config ?? await loadConfig();
    if (!currentConfig) return;
    await updateConfig({
      ...currentConfig,
      ui: { ...currentConfig.ui, appearance: themeMode === 'dark' ? 'light' : 'dark' },
    }).catch((error) => console.error('Failed to switch theme', error));
  }, [config, loadConfig, themeMode, updateConfig]);

  useEffect(() => {
    void applyVaultSnippets(workspacePath, config?.ui.enabledSnippets ?? {});
  }, [config?.ui.enabledSnippets, workspacePath]);

  useEffect(() => {
    const legacy = config?.ui.enabledSnippets?.__legacy__;
    if (!workspacePath || !config || !legacy) return;
    const enabledSnippets = { ...(config.ui.enabledSnippets ?? {}) };
    delete enabledSnippets.__legacy__;
    void updateConfig({
      ...config,
      ui: {
        ...config.ui,
        enabledSnippets: {
          ...enabledSnippets,
          [workspacePath]: enabledSnippets[workspacePath] ?? legacy,
        },
      },
    }).catch((error) => console.error('Failed to migrate vault CSS snippet settings', error));
  }, [config, workspacePath, updateConfig]);

  const activePaneTabIds = useMemo(
    () => paneLeaves(layout).flatMap((pane) => pane.activeTabId ? [pane.activeTabId] : []),
    [layout],
  );
  const liveTabIds = useLiveTabs(
    tabs,
    activeTabId,
    config?.editor.liveTabs ?? DEFAULT_LIVE_TABS,
    activePaneTabIds,
  );
  const livePanes = liveTabIds.flatMap((tabId) => {
    const tab = tabs.find((candidate) => candidate.tabId === tabId);
    return tab && tab.kind === 'document' ? [tab] : [];
  });

  const openNote = useCallback((
    path: string,
    options?: {
      offset?: number;
      disposition?: LinkDisposition;
      record?: boolean;
      paneId?: string;
    },
  ) => {
    const {
      offset,
      disposition = 'current',
      record = true,
      paneId,
    } = options ?? {};
    if (offset === undefined && activeFile === path && paneId === undefined) return;
    const isNote = isMarkdownPath(path);
    if (isNote) beginOpenTrace(path);
    if (record && isNote) {
      if (activeFile && activeFile !== path && isMarkdownPath(activeFile)) {
        push(activeFile);
      }
      push(path);
    }
    if (offset !== undefined) {
      const nonce = crypto.randomUUID();
      setSearchReveal({ path, paneId: paneId ?? activePaneId, offset, nonce });
    }
    activateFile(path, { disposition, paneId });
  }, [activateFile, activeFile, activePaneId, push]);

  const handleOpenExternalUrl = useCallback((url: string) => {
    void openExternalUrl(url).catch((error) => {
      console.error('Failed to open external URL', error);
    });
  }, []);

  const restoreNavigation = useCallback((delta: -1 | 1) => {
    const path = go(delta);
    if (!path) return;
    openNote(path, { record: false });
  }, [go, openNote]);

  useEffect(() => {
    markBootStage('shell');
  }, []);

  useEffect(() => {
    if (workspacePath) markBootStage('workspace');
  }, [workspacePath]);

  useEffect(() => {
    if (sessionReady) markBootStage('session');
  }, [sessionReady]);

  useEffect(() => {
    void loadConfig().finally(() => markBootStage('config'));
  }, [loadConfig]);

  useWindowDocumentSync();

  useTauriSubscription(
    () => getCurrentWindow().onCloseRequested(() => flushDocuments()),
    "window close",
  );

  useEffect(() => {
    if (config) installUpdateOnStartup(config.updates.auto);
  }, [config]);

  useRetentionCleanup(workspacePath, config);

  useEffect(() => {
    keepVersionsOf(tabs.map((tab) => tab.tabId));
  }, [tabs]);

  const handleTemplateSelect = useCallback(async (template: NoteTemplate) => {
    const content = await readTemplate(template);
    if (activeTab?.kind === 'document' && isMarkdownPath(activeTab.path)) {
      await applyTemplateToDocument(activeTab.path, content);
    }
    else await createFromTemplate(content);
    templates.hide();
  }, [activeTab, createFromTemplate, templates.hide]);

  useEffect(() => {
    const preventBrowserHistory = (event: MouseEvent) => {
      if (event.button === 3 || event.button === 4) event.preventDefault();
    };
    const handleMouseUp = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        restoreNavigation(-1);
      } else if (event.button === 4) {
        event.preventDefault();
        restoreNavigation(1);
      }
    };
    const blockNativeContextMenu = (event: Event) => {
      event.preventDefault();
    };
    window.addEventListener('mousedown', preventBrowserHistory, true);
    window.addEventListener('mouseup', handleMouseUp, true);
    window.addEventListener('contextmenu', blockNativeContextMenu, true);
    return () => {
      window.removeEventListener('mousedown', preventBrowserHistory, true);
      window.removeEventListener('mouseup', handleMouseUp, true);
      window.removeEventListener('contextmenu', blockNativeContextMenu, true);
    };
  }, [restoreNavigation]);

  const handleOpenSearchResult = useCallback((
    result: SearchResult,
    disposition: LinkDisposition,
  ) => {
    openNote(result.path, { offset: result.matchOffset, disposition });
  }, [openNote]);

  const resolveVisibleWikiLinks = useCallback(async (targets: string[], sourcePath = activeFile) => {
    if (!workspacePath || !sourcePath) return { paths: targets.map(() => null), complete: false };
    await ensureLinksReady();
    return resolveWikiLinks(workspacePath, sourcePath, targets);
  }, [activeFile, ensureLinksReady, workspacePath]);

  const handleOpenWikiLink = useCallback((
    target: string,
    disposition: LinkDisposition,
    paneId?: string,
  ) => {
    const sourcePane = paneId ? paneLeaves(layout).find((pane) => pane.paneId === paneId) : null;
    const sourcePath = tabs.find((tab) => tab.tabId === sourcePane?.activeTabId)?.path ?? activeFile;
    void resolveVisibleWikiLinks([target], sourcePath).then(async ({ paths: [path], complete }) => {
      if (!path && complete) {
        const created = await createLinkedFile(target);
        if (created) openNote(created, { disposition, paneId });
      } else if (path) {
        openNote(path, { disposition, paneId });
      }
    }).catch((error) => console.error('Failed to open wiki link', error));
  }, [activeFile, createLinkedFile, layout, openNote, resolveVisibleWikiLinks, tabs]);

  const homePage = workspaceHomePage.trim();
  useEffect(() => {
    if (!homePage || !workspacePath) {
      setHomePagePath(null);
      return;
    }
    let active = true;
    void ensureLinksReady()
      .then(() => resolveWikiLinks(workspacePath, workspacePath, [homePage]))
      .then(({ paths: [path] }) => { if (active) setHomePagePath(path ?? null); })
      .catch((error) => {
        console.error('Failed to resolve the home page', error);
        if (active) setHomePagePath(null);
      });
    return () => { active = false; };
  }, [ensureLinksReady, homePage, linkIndexRevision, workspacePath]);

  const openHomePage = useCallback(() => {
    if (homePagePath) openNote(homePagePath);
  }, [homePagePath, openNote]);

  const handleOpenBacklink = useCallback((
    backlink: Backlink,
    disposition: LinkDisposition,
  ) => {
    openNote(backlink.path, { offset: backlink.offset, disposition });
  }, [openNote]);

  const handleOpenOutgoingLink = useCallback((
    link: OutgoingLink,
    disposition: LinkDisposition,
  ) => {
    if (!link.path) handleOpenWikiLink(link.target, disposition);
    else openNote(link.path, { disposition });
  }, [handleOpenWikiLink, openNote]);

  const handleOpenAnalysisResult = useCallback((
    result: AnalysisResult,
    disposition: LinkDisposition,
  ) => {
    openNote(result.path, { disposition });
  }, [openNote]);

  const toggleLeftSidebar = useCallback(() => {
    setLeftSidebarOpen((current) => !current);
  }, []);

  const openBoards = useCallback(() => {
    setSidebarPanel('boards');
    setLeftSidebarOpen(true);
  }, [setLeftSidebarOpen]);

  const openFileManager = useCallback(() => {
    setSidebarPanel('files');
    setLeftSidebarOpen(true);
  }, [setLeftSidebarOpen]);

  const toggleBoards = useCallback(() => {
    if (!kanbanEnabled) return;
    setSidebarPanel((current) => leftSidebarVisible && current === 'boards' ? 'files' : 'boards');
    setLeftSidebarOpen(true);
  }, [kanbanEnabled, leftSidebarVisible, setLeftSidebarOpen]);

  useEffect(() => {
    if (kanbanEnabled) return;
    setSidebarPanel((current) => current === 'boards' ? 'files' : current);
    setBoardActionRequest(null);
  }, [kanbanEnabled]);

  const openNewBoard = useCallback(() => {
    if (!kanbanEnabled) return;
    openBoards();
    setCreateBoardRequest((current) => current + 1);
  }, [kanbanEnabled, openBoards]);

  const requestBoardAction = useCallback((path: string, action: BoardActionRequest['action']) => {
    if (!kanbanEnabled) return;
    openBoards();
    boardRequestId.current += 1;
    setBoardActionRequest({ path, action, id: boardRequestId.current });
  }, [kanbanEnabled, openBoards]);

  const openBaseView = useCallback((path: string, index: number) => {
    boardRequestId.current += 1;
    setBaseViewRequest({ path, index, id: boardRequestId.current, paneId: activePaneId });
    openNote(path);
  }, [activePaneId, openNote]);

  const addCurrentNoteToBoard = useCallback(() => {
    if (activeFile && isMarkdownPath(activeFile)) requestBoardAction(activeFile, 'add');
    openBoards();
  }, [activeFile, openBoards, requestBoardAction]);

  const removeNoteFromBoard = useCallback((path: string) => {
    requestBoardAction(path, 'remove');
  }, [requestBoardAction]);

  const toggleRightSidebar = useCallback(() => {
    setRightSidebarOpen((current) => !current);
  }, []);

  const commandRegistry = useMemo(() => new CommandRegistry([
    {
      id: 'command.palette',
      title: t('commands.title'),
      keywords: ['command', 'palette'],
      shortcut: SHORTCUTS.COMMAND_PALETTE,
      run: commandPalette.toggle,
    },
    {
      id: 'note.new',
      title: t('commands.newNote'),
      shortcut: SHORTCUTS.NEW_FILE,
      enabled: () => Boolean(workspacePath),
      run: () => createNewFile(),
    },
    {
      id: 'note.template',
      title: t('commands.newFromTemplate'),
      shortcut: SHORTCUTS.NEW_FROM_TEMPLATE,
      enabled: () => Boolean(workspacePath),
      run: templates.show,
    },
    {
      id: 'canvas.new',
      title: t('commands.newCanvas'),
      enabled: () => Boolean(workspacePath),
      run: createCanvas,
    },
    {
      id: 'search.global',
      title: t('commands.search'),
      shortcut: SHORTCUTS.GLOBAL_SEARCH,
      enabled: () => Boolean(workspacePath),
      run: search.show,
    },
    {
      id: 'view.focus',
      title: t('commands.focus'),
      shortcut: SHORTCUTS.FOCUS_MODE,
      run: toggleFocusMode,
    },
    { id: 'view.graph', title: t('commands.graph'), enabled: () => Boolean(workspacePath), run: openGraph },
    { id: 'boards.open', title: t('commands.boards'), enabled: () => Boolean(workspacePath && kanbanEnabled), run: openBoards },
    { id: 'boards.new', title: t('commands.newBoard'), enabled: () => Boolean(workspacePath && kanbanEnabled), run: openNewBoard },
    { id: 'boards.addCurrentNote', title: t('commands.addCurrentNoteToBoard'), enabled: () => Boolean(kanbanEnabled && activeFile && isMarkdownPath(activeFile)), run: addCurrentNoteToBoard },
    { id: 'view.settings', title: t('commands.settings'), run: settings.show },
    { id: 'workspace.switch', title: t('commands.workspaces'), run: workspaces.show },
    { id: 'view.sidebar.left', title: t('commands.leftSidebar'), run: toggleLeftSidebar },
    { id: 'view.sidebar.right', title: t('commands.rightSidebar'), run: toggleRightSidebar },
    { id: 'theme.toggle', title: t('commands.theme'), run: toggleTheme },
  ]), [
    commandPalette.toggle, config, createCanvas, createNewFile, openGraph, search.show, settings.show,
    templates.show, toggleFocusMode, toggleLeftSidebar, toggleRightSidebar, toggleTheme,
    workspaces.show, workspacePath, openBoards, openNewBoard, addCurrentNoteToBoard, activeFile, kanbanEnabled,
  ]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const command = commandRegistry.list().find((candidate) => (
        candidate.shortcut && matchesShortcut(event, candidate.shortcut)
      ));
      if (!command) return;
      event.preventDefault();
      void commandRegistry.execute(command.id)
        .catch((error) => console.error('Failed to execute shortcut', error));
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [commandRegistry]);



  const handleFileRenamed = useCallback((oldPath: string, newPath: string) => {
    patchFileInTree(oldPath, { id: newPath, name: fileStem(newPath) });
    setSearchReveal((current) => (
      current?.path === oldPath ? { ...current, path: newPath } : current
    ));
    handleExternalRename(oldPath, newPath);
  }, [handleExternalRename, patchFileInTree]);

  const tabTargets = useCallback((path: string) => [path], []);
  const tabFileOps = useFileTreeActions({
    workspacePath,
    targetsFor: tabTargets,
    onPatchFileInTree: patchFileInTree,
  });
  useNoteRelocation({ renamed: handleFileRenamed, deleted: closeTab });

  useActiveNoteReport(activeFile && isMarkdownPath(activeFile) ? activeFile : null);
  useMcpNavigation({
    openNote: (path, disposition) => openNote(path, { disposition }),
    openWorkspace: (path) => { void openWorkspace(path); },
  });

  const renderPane = (paneId: string) => {
    const pane = paneLeaves(layout).find((item) => item.paneId === paneId);
    if (!pane) return null;
    const paneTabs = tabs.filter((tab) => tab.paneId === paneId);
    const paneActiveTab = paneTabs.find((tab) => tab.tabId === pane.activeTabId) ?? paneTabs[0] ?? null;
    const graphTab = paneTabs.find((tab) => tab.kind === 'graph') ?? null;
    const graphActive = graphTab?.tabId === paneActiveTab?.tabId;
    const activeBasePath = paneActiveTab?.kind === 'document' && isBasePath(paneActiveTab.path)
      ? paneActiveTab.path : null;
    const activeCanvasPath = paneActiveTab?.kind === 'document' && isCanvasPath(paneActiveTab.path)
      ? paneActiveTab.path : null;

    return (
      <div
        className="q-app-main"
        key={paneId}
        data-pane-drop-target={paneId}
        onMouseDownCapture={() => focusPane(paneId)}
        onFocusCapture={() => focusPane(paneId)}
      >
        <Titlebar
          paneId={paneId}
          tabItems={paneTabs.map(({ tabId, path }) => ({ tabId, path }))}
          activeFile={paneActiveTab?.path ?? null}
          onReorder={(from, to) => reorderTabs(from, to, paneId)}
          onMoveTab={moveTab}
          renamingPath={tabFileOps.renamingPath}
          tabActions={tabFileOps.rowActions}
          onSelect={(path, tabId) => {
            if (!tabId) return;
            const tab = paneTabs.find((item) => item.tabId === tabId);
            if (tab?.kind === 'document' && !isBasePath(path)) openNote(path, { paneId });
            else selectTab(tabId, paneId);
          }}
          onClose={closeTab}
          onNewTab={() => newTab(paneId)}
          onSplitHorizontal={panesEnabled && paneLeaves(layout).length < 4
            ? () => splitPane(paneId, 'horizontal') : undefined}
          onSplitVertical={panesEnabled && paneLeaves(layout).length < 4
            ? () => splitPane(paneId, 'vertical') : undefined}
          onClosePane={panesEnabled && paneLeaves(layout).length > 1
            ? () => removePane(paneId) : undefined}
          rightSidebarOpen={rightSidebarVisible}
          onToggleRightSidebar={focusMode || paneId !== activePaneId
            ? undefined
            : () => { void commandRegistry.execute('view.sidebar.right'); }}
        />
        <div className="q-app-content">
          {!workspacePath ? (
            workspaceRestoring ? null : (
              <WorkspaceEmptyState onOpen={openWorkspace} failedPath={openFailedPath} />
            )
          ) : !sessionReady ? (
            <div className="q-app-editor-boot" aria-busy="true" />
          ) : (
            <>
              {graphTab && (
                <Suspense fallback={null}>
                  <GraphView
                    workspacePath={workspacePath}
                    indexRevision={linkIndexRevision}
                    inactive={!graphActive}
                    sessionReady={sessionReady}
                    readCamera={readGraphCamera}
                    onCameraChange={onGraphCameraChange}
                    onOpenNote={(path) => openNote(path, { paneId })}
                  />
                </Suspense>
              )}
              <main className={graphActive || activeCanvasPath ? 'q-app-editor q-offstage' : 'q-app-editor'}>
                {activeBasePath && (
                  <Suspense fallback={null}>
                    <BaseView
                      path={activeBasePath}
                      workspacePath={workspacePath}
                      indexReady={linkIndexReady}
                      indexRevision={linkIndexRevision}
                      onOpenNote={(path) => openNote(path, { paneId })}
                      viewRequest={baseViewRequest?.path === activeBasePath && baseViewRequest.paneId === paneId ? baseViewRequest : null}
                      onViewRequestConsumed={(id) => {
                        setBaseViewRequest((current) => current?.id === id ? null : current);
                      }}
                    />
                  </Suspense>
                )}
                {activeCanvasPath && (
                  <Suspense fallback={null}>
                    <CanvasView
                      key={`${paneId}:${activeCanvasPath}`}
                      path={activeCanvasPath}
                      workspacePath={workspacePath}
                      onOpenFile={(path) => openNote(path, { paneId })}
                    />
                  </Suspense>
                )}
                {!activeBasePath && !activeCanvasPath && paneActiveTab?.kind === 'empty' ? (
                  <NewTab
                    key={paneActiveTab.tabId}
                    onCreate={createNewFile}
                    onOpen={search.show}
                    onClose={() => closeTab(paneActiveTab.path, paneActiveTab.tabId)}
                  />
                ) : null}
                {livePanes.filter((tab) => tab.paneId === paneId).map((tab) => (
                  <EditorPane
                    key={`${tab.tabId}:${paneId}:${searchReveal?.paneId === paneId && searchReveal.path === tab.path ? searchReveal.nonce : ''}`}
                    paneId={paneId}
                    inactive={tab.tabId !== paneActiveTab?.tabId}
                    focused={tab.tabId === activeTabId}
                    canGoBack={canGoBack}
                    canGoForward={canGoForward}
                    onNavigate={restoreNavigation}
                    tab={tab}
                    remountNonce={searchReveal?.paneId === paneId && searchReveal.path === tab.path ? searchReveal.nonce : ''}
                    workspacePath={workspacePath}
                    ensureLinksReady={ensureLinksReady}
                    linkRevision={linkIndexRevision}
                    loadedView={loadedView}
                    isViewLoaded={isViewLoaded}
                    viewRevision={viewRevision}
                    stateError={stateError}
                    revealOffset={searchReveal?.paneId === paneId && searchReveal.path === tab.path ? searchReveal.offset : undefined}
                    onViewStateChange={onViewStateChange}
                    onFileMissing={closeTab}
                    onOpenWikiLink={(target, disposition) => handleOpenWikiLink(target, disposition, paneId)}
                    onOpenExternalUrl={handleOpenExternalUrl}
                    focusMode={focusMode}
                    onToggleFocusMode={toggleFocusMode}
                  />
                ))}
              </main>
            </>
          )}
        </div>
      </div>
    );
  };

  const visiblePaneLayout = panesEnabled
    ? layout
    : paneLeaves(layout).find((pane) => pane.paneId === activePaneId) ?? paneLeaves(layout)[0];

  return (
    <div className="q-app-shell" key={resolveLocale(config?.ui.language)}>
      <div className="q-app-workspace">
        <SidebarRail
          isSidebarOpen={leftSidebarVisible}
          onToggleSidebar={focusMode ? undefined : toggleLeftSidebar}
          onOpenGraph={focusMode ? undefined : () => { void commandRegistry.execute('view.graph'); }}
          onOpenHome={homePagePath && !focusMode ? openHomePage : undefined}
          onOpenSettings={focusMode
            ? () => { void commandRegistry.execute('view.settings'); }
            : undefined}
          onOpenBoards={focusMode || !kanbanEnabled ? undefined : toggleBoards}
          onOpenFiles={focusMode ? undefined : openFileManager}
          boardsActive={sidebarPanel === 'boards' && leftSidebarVisible}
          filesActive={sidebarPanel === 'files' && leftSidebarVisible}
        />
        <Sidebar
          activeFile={activeFile}
          files={files}
          directories={directories}
          loadingDirectories={loadingDirectories}
          workspacePath={workspacePath}
          workspaceName={workspaceName}
          onFileSelect={openNote}
          onCreateNote={() => commandRegistry.execute('note.new').then(() => undefined)}
          onLoadDirectory={loadDirectory}
          isOpen={leftSidebarVisible}
          onOpenSettings={() => { void commandRegistry.execute('view.settings'); }}
          onOpenWorkspaces={() => { void commandRegistry.execute('workspace.switch'); }}
          onToggleTheme={toggleTheme}
          onPatchFileInTree={patchFileInTree}
          panel={sidebarPanel}
          onOpenBaseView={openBaseView}
          boardActionRequest={boardActionRequest}
          onBoardActionRequestComplete={() => setBoardActionRequest(null)}
          createBoardRequest={createBoardRequest}
          onAddToBoard={kanbanEnabled ? (path) => requestBoardAction(path, 'add') : undefined}
          onRemoveFromBoard={kanbanEnabled ? removeNoteFromBoard : undefined}
        />

        {panesEnabled ? (
          <PaneLayoutView layout={visiblePaneLayout} renderPane={renderPane} onResize={(path, ratio) => resizePane(path, ratio)} />
        ) : renderPane(activePaneId)}
        <BacklinksPanel
          workspacePath={workspacePath}
          documentPath={activeFile}
          activeTabId={activeTabId}
          indexReady={linkIndexReady}
          indexRevision={linkIndexRevision}
          isOpen={rightSidebarVisible}
          onOpenBacklink={handleOpenBacklink}
          onOpenOutgoing={handleOpenOutgoingLink}
          onOpenAnalysis={handleOpenAnalysisResult}
          onOpenLocalGraph={(path, disposition) => openNote(path, { disposition })}
        />
      </div>

      <WindowControls />
      <UpdateSplash />

      <DeleteNotesDialog
        targets={tabFileOps.deleteTargets}
        pending={tabFileOps.isDeleting}
        onCancel={tabFileOps.dismissDelete}
        onConfirm={tabFileOps.confirmDelete}
      />

      <SearchDialog
        open={search.open}
        workspacePath={workspacePath}
        onClose={search.hide}
        onOpenResult={handleOpenSearchResult}
        onCreate={createNewFile}
      />
      {commandPalette.open && (
        <Suspense fallback={null}>
          <CommandPalette
            open
            registry={commandRegistry}
            onClose={commandPalette.hide}
          />
        </Suspense>
      )}
      <TemplateDialog open={templates.open} workspacePath={workspacePath}
        folder={config?.templates.folder ?? ''} onClose={templates.hide}
        onSelect={handleTemplateSelect} />

      {settings.open && (
        <Suspense fallback={null}>
          <SettingsDialog
            open
            workspacePath={workspacePath}
            homePage={workspaceHomePage}
            onHomePageChange={changeHomePage}
            onClose={settings.hide}
          />
        </Suspense>
      )}

      <WorkspaceDialog
        open={workspaces.open}
        currentPath={workspacePath}
        onClose={workspaces.hide}
        onOpenWorkspace={openWorkspace}
      />
    </div>
  );
}
