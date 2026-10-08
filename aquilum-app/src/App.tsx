import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorPane } from "./components/Editor/EditorPane";
import { Titlebar } from "./components/Layout/Titlebar";
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
import { DEFAULT_LIVE_TABS, useSettingsStore } from "./modules/settings";
import { installUpdateOnStartup } from "./modules/updates";
import { resolveLocale, t } from "./i18n";
import { useActiveNoteReport, useMcpNavigation } from "./modules/mcp";
import { isBasePath, isMarkdownPath } from "./modules/documents/fileGateway";
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
import "./App.css";

const GraphView = lazy(() => import("./components/Graph/GraphView")
  .then((module) => ({ default: module.GraphView })));
const SettingsDialog = lazy(() => import("./components/Settings/SettingsDialog")
  .then((module) => ({ default: module.SettingsDialog })));
const CommandPalette = lazy(() => import("./components/Commands/CommandPalette")
  .then((module) => ({ default: module.CommandPalette })));
const BaseView = lazy(() => import("./components/Bases/BaseView")
  .then((module) => ({ default: module.BaseView })));

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
    offset: number;
    nonce: string;
  } | null>(null);
  const [revealNonceByPath, setRevealNonceByPath] = useState<Record<string, string>>({});
  const [homePagePath, setHomePagePath] = useState<string | null>(null);
  const [sidebarPanel, setSidebarPanel] = useState<'files' | 'boards'>('files');
  const [boardActionRequest, setBoardActionRequest] = useState<BoardActionRequest | null>(null);
  const [createBoardRequest, setCreateBoardRequest] = useState(0);
  const [baseViewRequest, setBaseViewRequest] = useState<{ path: string; index: number; id: number } | null>(null);
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
    openFiles,
    activeFile,
    activeTabId,
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
    openGraph,
    readGraphCamera,
    onGraphCameraChange,
    createNewFile,
    createFromTemplate,
    createLinkedFile,
    handleExternalRename
  } = useTabs(workspacePath, workspaceReady);
  const activeTab = tabs.find((tab) => tab.tabId === activeTabId) ?? null;
  const hasGraphTab = tabs.some((tab) => tab.kind === 'graph');
  const graphActive = activeTab?.kind === 'graph';
  const activeBasePath = activeTab?.kind === 'document' && isBasePath(activeTab.path)
    ? activeTab.path : null;
  const {
    push,
    go,
    canGoBack,
    canGoForward,
  } = useNavigationHistory(workspacePath);

  const { config, loadConfig, updateConfig } = useSettingsStore();
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

  const liveTabIds = useLiveTabs(tabs, activeTabId, config?.editor.liveTabs ?? DEFAULT_LIVE_TABS);
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
    },
  ) => {
    const {
      offset,
      disposition = 'current',
      record = true,
    } = options ?? {};
    if (offset === undefined && activeFile === path) return;
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
      setSearchReveal({ path, offset, nonce });
      setRevealNonceByPath((current) => ({ ...current, [path]: nonce }));
    }
    activateFile(path, { disposition });
  }, [activateFile, activeFile, push]);

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

  const resolveVisibleWikiLinks = useCallback(async (targets: string[]) => {
    if (!workspacePath || !activeFile) return { paths: targets.map(() => null), complete: false };
    await ensureLinksReady();
    return resolveWikiLinks(workspacePath, activeFile, targets);
  }, [activeFile, ensureLinksReady, workspacePath]);

  const handleOpenWikiLink = useCallback((
    target: string,
    disposition: LinkDisposition,
  ) => {
    void resolveVisibleWikiLinks([target]).then(async ({ paths: [path], complete }) => {
      if (!path && complete) {
        const created = await createLinkedFile(target);
        if (created) openNote(created, { disposition });
      } else if (path) {
        openNote(path, { disposition });
      }
    }).catch((error) => console.error('Failed to open wiki link', error));
  }, [createLinkedFile, openNote, resolveVisibleWikiLinks]);

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

  const toggleBoards = useCallback(() => {
    setSidebarPanel((current) => leftSidebarVisible && current === 'boards' ? 'files' : 'boards');
    setLeftSidebarOpen(true);
  }, [leftSidebarVisible, setLeftSidebarOpen]);

  const openNewBoard = useCallback(() => {
    openBoards();
    setCreateBoardRequest((current) => current + 1);
  }, [openBoards]);

  const requestBoardAction = useCallback((path: string, action: BoardActionRequest['action']) => {
    openBoards();
    boardRequestId.current += 1;
    setBoardActionRequest({ path, action, id: boardRequestId.current });
  }, [openBoards]);

  const openBaseView = useCallback((path: string, index: number) => {
    boardRequestId.current += 1;
    setBaseViewRequest({ path, index, id: boardRequestId.current });
    openNote(path);
  }, [openNote]);

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
    { id: 'boards.open', title: t('commands.boards'), enabled: () => Boolean(workspacePath), run: openBoards },
    { id: 'boards.new', title: t('commands.newBoard'), enabled: () => Boolean(workspacePath), run: openNewBoard },
    { id: 'boards.addCurrentNote', title: t('commands.addCurrentNoteToBoard'), enabled: () => Boolean(activeFile && isMarkdownPath(activeFile)), run: addCurrentNoteToBoard },
    { id: 'view.settings', title: t('commands.settings'), run: settings.show },
    { id: 'workspace.switch', title: t('commands.workspaces'), run: workspaces.show },
    { id: 'view.sidebar.left', title: t('commands.leftSidebar'), run: toggleLeftSidebar },
    { id: 'view.sidebar.right', title: t('commands.rightSidebar'), run: toggleRightSidebar },
    { id: 'theme.toggle', title: t('commands.theme'), run: toggleTheme },
  ]), [
    commandPalette.toggle, config, createNewFile, openGraph, search.show, settings.show,
    templates.show, toggleFocusMode, toggleLeftSidebar, toggleRightSidebar, toggleTheme,
    workspaces.show, workspacePath, openBoards, openNewBoard, addCurrentNoteToBoard, activeFile,
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
    setRevealNonceByPath((current) => {
      const nonce = current[oldPath];
      if (nonce === undefined) return current;
      const { [oldPath]: _moved, ...rest } = current;
      return { ...rest, [newPath]: nonce };
    });
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
          onOpenBoards={focusMode ? undefined : toggleBoards}
          boardsActive={sidebarPanel === 'boards' && leftSidebarVisible}
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
          onAddToBoard={(path) => requestBoardAction(path, 'add')}
          onRemoveFromBoard={removeNoteFromBoard}
        />

        <div className="q-app-main">
          <Titlebar
            activeFile={activeFile}
            openFiles={openFiles}
            onReorder={reorderTabs}
            renamingPath={tabFileOps.renamingPath}
            tabActions={tabFileOps.rowActions}
            onSelect={openNote}
            onClose={closeTab}
            onNewTab={newTab}
            rightSidebarOpen={rightSidebarVisible}
            onToggleRightSidebar={focusMode
              ? undefined
              : () => { void commandRegistry.execute('view.sidebar.right'); }}
          />

          <div className="q-app-content">

            {hasGraphTab && (
              <Suspense fallback={null}>
                <GraphView
                  workspacePath={workspacePath}
                  indexRevision={linkIndexRevision}
                  inactive={!graphActive}
                  sessionReady={sessionReady}
                  readCamera={readGraphCamera}
                  onCameraChange={onGraphCameraChange}
                  onOpenNote={openNote}
                />
              </Suspense>
            )}
            <main className={graphActive ? "q-app-editor q-offstage" : "q-app-editor"}>
              {!workspacePath ? (
                workspaceRestoring ? null : (
                  <WorkspaceEmptyState onOpen={openWorkspace} failedPath={openFailedPath} />
                )
              ) : !sessionReady ? (
                <div className="q-app-editor-boot" aria-busy="true" />
              ) : (
                <>
                  {activeBasePath && (
                    <Suspense fallback={null}>
                      <BaseView
                        path={activeBasePath}
                        workspacePath={workspacePath}
                        indexReady={linkIndexReady}
                        indexRevision={linkIndexRevision}
                        onOpenNote={openNote}
                        viewRequest={baseViewRequest}
                        onViewRequestConsumed={(id) => {
                          setBaseViewRequest((current) => current?.id === id ? null : current);
                        }}
                      />
                    </Suspense>
                  )}
                  {!activeBasePath && activeTab?.kind === 'empty' ? (
                    <NewTab
                      key={activeTab.tabId}
                      onCreate={createNewFile}
                      onOpen={search.show}
                      onClose={() => closeTab(activeTab.path)}
                    />
                  ) : null}
                  {livePanes.map((tab) => (
                    <EditorPane
                      key={tab.tabId}
                      inactive={tab.tabId !== activeTabId}
                      canGoBack={canGoBack}
                      canGoForward={canGoForward}
                      onNavigate={restoreNavigation}
                      tab={tab}
                      remountNonce={revealNonceByPath[tab.path] ?? ''}
                      workspacePath={workspacePath}
                      ensureLinksReady={ensureLinksReady}
                      linkRevision={linkIndexRevision}
                      loadedView={loadedView}
                      isViewLoaded={isViewLoaded}
                      viewRevision={viewRevision}
                      stateError={stateError}
                      revealOffset={
                        searchReveal?.path === tab.path ? searchReveal.offset : undefined
                      }
                      onViewStateChange={onViewStateChange}
                      onFileMissing={closeTab}
                      onOpenWikiLink={handleOpenWikiLink}
                      onOpenExternalUrl={handleOpenExternalUrl}
                      focusMode={focusMode}
                      onToggleFocusMode={toggleFocusMode}
                    />
                  ))}
                </>
              )}
            </main>
          </div>
        </div>
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
