import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { EditorPane } from "./components/Editor/EditorPane";
import { TextFilePane } from "./components/Editor/TextFilePane";
import { Titlebar } from "./components/Layout/Titlebar";
import { PaneLayoutView } from "./components/Layout/PaneLayoutView";
import { WindowControls } from "./components/Layout/WindowControls";
import { Sidebar } from "./components/Layout/Sidebar";
import { SidebarRail } from "./components/Layout/SidebarRail";
import { PanelResizer } from "./components/Layout/PanelResizer";
import { UpdateSplash } from "./components/Common/UpdateSplash";
import { DeleteNotesDialog } from "./components/Common/DeleteNotesDialog";
import { useFileTreeActions } from "./components/Layout/useFileTreeActions";
import { NewTab } from "./components/Editor/NewTab";
import { WorkspaceEmptyState } from "./components/Workspace/WorkspaceEmptyState";
import { SearchDialog } from "./components/Search/SearchDialog";
import { TemplateDialog } from "./components/Templates/TemplateDialog";
import { TypePickerDialog } from "./components/Schema/TypePickerDialog";
import { WorkspaceDialog } from "./components/Workspace/WorkspaceDialog";
import { GalleryDialog } from "./components/Gallery/GalleryDialog";
import { BacklinksPanel } from "./components/Backlinks/BacklinksPanel";
import { useWorkspace } from "./hooks/useWorkspace";
import { useTabs } from "./hooks/useTabs";
import { useNavigationHistory } from "./hooks/useNavigationHistory";
import { useLiveTabs } from "./hooks/useLiveTabs";
import { useLocalState } from "./modules/workspace/uiPersist";
import { PANEL_LIMITS, clampPanelWidth } from "./modules/layout/panelWidth";
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
import { isBasePath, isCanvasPath, isMarkdownPath, isPdfPath, isTextFilePath, readFileSnapshot, writeFileAtomic } from "./modules/documents/fileGateway";
import type { CanvasNoteTarget } from "./components/Canvas/canvasNoteLinks";
import { resolveFragmentOffset, splitLinkTarget } from "./modules/links/fragment";
import { createCanvasFile } from "./modules/canvas/createCanvasFile";
import { flushCanvasDocuments } from "./modules/canvas/persistence";
import { fileStem } from "./modules/paths";
import { useNoteRelocation } from "./modules/documents/useNoteRelocation";
import { readTemplate, type NoteTemplate } from "./modules/templates";
import { journalToday } from "./modules/journal";
import { keepVersionsOf } from "./modules/history";
import { useRetentionCleanup } from "./hooks/useRetentionCleanup";
import { applyVaultSnippets } from "./modules/docs/vaultSnippets";
import { flushDocuments } from "./modules/documents/documentGateway";
import { readNoteType, setNoteType } from "./modules/schema/setNoteType";
import { useWindowDocumentSync } from "./modules/documents/useWindowDocumentSync";
import { applyTemplateToDocument } from "./components/Editor/docMutations";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMacOs } from "./modules/platform";
import { useTauriSubscription } from "./hooks/useTauriEvent";
import { useOverlay } from "./hooks/useOverlay";
import { useThemeMode } from "./hooks/useThemeMode";
import { transitionThemeFrom } from "./modules/theme/transition";
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
const PdfViewer = lazy(() => import("./components/Pdf/PdfViewer")
  .then((module) => ({ default: module.PdfViewer })));

export default function App() {
  const search = useOverlay();
  const commandPalette = useOverlay();
  const templates = useOverlay();
  const typePicker = useOverlay();
  const settings = useOverlay();
  const workspaces = useOverlay();
  const gallery = useOverlay();
  const [leftSidebarOpen, setLeftSidebarOpen] = useLocalState('obsidium_sidebar_left_open', true);
  const [rightSidebarOpen, setRightSidebarOpen] = useLocalState('obsidium_sidebar_right_open', true);
  const [storedLeftWidth, setStoredLeftWidth] = useLocalState<number>('obsidium_sidebar_left_width', PANEL_LIMITS.left.fallback);
  const [storedRightWidth, setStoredRightWidth] = useLocalState<number>('obsidium_sidebar_right_width', PANEL_LIMITS.right.fallback);
  const leftWidth = clampPanelWidth('left', storedLeftWidth);
  const rightWidth = clampPanelWidth('right', storedRightWidth);
  const setLeftWidth = useCallback((width: number) => {
    setStoredLeftWidth(clampPanelWidth('left', width));
  }, [setStoredLeftWidth]);
  const setRightWidth = useCallback((width: number) => {
    setStoredRightWidth(clampPanelWidth('right', width));
  }, [setStoredRightWidth]);
  const [focusMode, setFocusMode] = useLocalState('obsidium_focus_mode', false);
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
  const [typeTarget, setTypeTarget] = useState<{ path: string; currentType: string | null } | null>(null);
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
  const toggleTheme = useCallback((origin?: HTMLElement) => {
    const update = async () => {
      const currentConfig = config ?? await loadConfig();
      if (!currentConfig) return;
      await updateConfig({
        ...currentConfig,
        ui: { ...currentConfig.ui, appearance: themeMode === 'dark' ? 'light' : 'dark' },
      }).catch((error) => console.error('Failed to switch theme', error));
    };
    if (origin) transitionThemeFrom(origin, update);
    else void update();
  }, [config, loadConfig, themeMode, updateConfig]);

  useEffect(() => {
    if (!isMacOs() || !config) return;
    const appearance = config.ui.appearance;
    void getCurrentWindow().setTheme(appearance === 'system' ? null : appearance)
      .catch((error) => console.error('Failed to sync native window theme', error));
  }, [config?.ui.appearance]);

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
    if (record) {
      if (activeFile && activeFile !== path) push(activeFile);
      push(path);
    }
    if (offset !== undefined) {
      const nonce = crypto.randomUUID();
      setSearchReveal({ path, paneId: paneId ?? activePaneId, offset, nonce });
    }
    activateFile(path, { disposition, paneId });
  }, [activateFile, activeFile, activePaneId, push]);

  const createNewCanvas = useCallback(async () => {
    if (!workspacePath) return;
    const path = await createCanvasFile(workspacePath);
    if (path) openNote(path);
  }, [openNote, workspacePath]);

  const openJournalToday = useCallback(async () => {
    if (!workspacePath) return;
    try {
      const note = await journalToday(workspacePath);
      openNote(note.path);
    } catch (error) {
      console.error('Failed to open the daily note', error);
    }
  }, [openNote, workspacePath]);

  const openCanvas = useCallback(() => {
    if (activeFile && isCanvasPath(activeFile)) {
      openNote(activeFile);
      return;
    }
    void createNewCanvas();
  }, [activeFile, createNewCanvas, openNote]);

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
    () => getCurrentWindow().onCloseRequested(async (event) => {
      const results = await Promise.all([flushDocuments(), flushCanvasDocuments()]);
      if (!results[1]) event.preventDefault();
    }),
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

  const openNoteAtFragment = useCallback(async (
    path: string,
    fragment: string,
    options: { disposition?: LinkDisposition; paneId?: string },
  ) => {
    if (!fragment) {
      openNote(path, options);
      return;
    }
    const offset = resolveFragmentOffset((await readFileSnapshot(path)).content, fragment);
    openNote(path, { offset: offset ?? undefined, ...options });
  }, [openNote]);

  const openCanvasNote = useCallback(async (
    link: CanvasNoteTarget,
    paneId: string,
    canvasPath: string,
    sourcePath: string | null,
  ) => {
    try {
      if (link.path) {
        await openNoteAtFragment(link.path.absolute, link.fragment, { paneId });
        return;
      }
      const base = sourcePath ?? canvasPath;
      const { paths: [path] } = await resolveVisibleWikiLinks([link.target], base);
      if (path) await openNoteAtFragment(path, link.fragment, { paneId });
    } catch (error) {
      console.error('Failed to open a Canvas note link', error);
      throw error;
    }
  }, [openNoteAtFragment, resolveVisibleWikiLinks]);

  const handleOpenWikiLink = useCallback((
    rawTarget: string,
    disposition: LinkDisposition,
    paneId?: string,
  ) => {
    const parts = splitLinkTarget(rawTarget);
    if (!parts) return;
    const { target, fragment } = parts;
    const sourcePane = paneId ? paneLeaves(layout).find((pane) => pane.paneId === paneId) : null;
    const sourcePath = tabs.find((tab) => tab.tabId === sourcePane?.activeTabId)?.path ?? activeFile;
    if (!target) {
      if (!sourcePath || !isMarkdownPath(sourcePath)) return;
      void openNoteAtFragment(sourcePath, fragment, { disposition, paneId })
        .catch((error) => console.error('Failed to open wiki link', error));
      return;
    }
    void resolveVisibleWikiLinks([target], sourcePath).then(async ({ paths: [path], complete }) => {
      if (path) {
        await openNoteAtFragment(path, fragment, { disposition, paneId });
      } else if (complete) {
        const created = await createLinkedFile(target);
        if (created) await openNoteAtFragment(created, fragment, { disposition, paneId });
      }
    }).catch((error) => console.error('Failed to open wiki link', error));
  }, [activeFile, createLinkedFile, layout, openNoteAtFragment, resolveVisibleWikiLinks, tabs]);

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
    if (!link.path) {
      handleOpenWikiLink(link.target, disposition);
      return;
    }
    const fragment = splitLinkTarget(link.target)?.fragment ?? '';
    void openNoteAtFragment(link.path, fragment, { disposition })
      .catch((error) => console.error('Failed to open outgoing link', error));
  }, [handleOpenWikiLink, openNoteAtFragment]);

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

  const openTypePicker = useCallback(async () => {
    if (!activeFile || !isMarkdownPath(activeFile)) return;
    try {
      const snapshot = await readFileSnapshot(activeFile);
      setTypeTarget({ path: activeFile, currentType: readNoteType(snapshot.content) });
    } catch (error) {
      console.error('Failed to read the note type', error);
      setTypeTarget({ path: activeFile, currentType: null });
    }
    typePicker.show();
  }, [activeFile, typePicker.show]);

  const applyNoteType = useCallback(async (typeName: string | null) => {
    const path = typeTarget?.path;
    if (!path) return;
    const snapshot = await readFileSnapshot(path);
    const next = setNoteType(snapshot.content, typeName);
    if (next === null) return;
    await writeFileAtomic(path, next, snapshot.hash);
    setTypeTarget((current) => (current ? { ...current, currentType: typeName } : current));
  }, [typeTarget?.path]);

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
      id: 'journal.today',
      title: t('commands.journalToday'),
      keywords: ['journal', 'daily', 'today'],
      shortcut: SHORTCUTS.JOURNAL_TODAY,
      enabled: () => Boolean(workspacePath),
      run: openJournalToday,
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
    {
      id: 'gallery.open',
      title: t('commands.openGallery'),
      keywords: ['gallery', 'images', 'галерея', 'изображения'],
      enabled: () => Boolean(workspacePath),
      run: gallery.show,
    },
    { id: 'boards.open', title: t('commands.boards'), enabled: () => Boolean(workspacePath && kanbanEnabled), run: openBoards },
    { id: 'boards.new', title: t('commands.newBoard'), enabled: () => Boolean(workspacePath && kanbanEnabled), run: openNewBoard },
    { id: 'boards.addCurrentNote', title: t('commands.addCurrentNoteToBoard'), enabled: () => Boolean(kanbanEnabled && activeFile && isMarkdownPath(activeFile)), run: addCurrentNoteToBoard },
    {
      id: 'schema.setType',
      title: t('commands.setType'),
      keywords: ['schema', 'type', 'тип', 'схема'],
      enabled: () => Boolean(workspacePath && activeFile && isMarkdownPath(activeFile)),
      run: openTypePicker,
    },
    { id: 'view.settings', title: t('commands.settings'), run: settings.show },
    { id: 'workspace.switch', title: t('commands.workspaces'), run: workspaces.show },
    { id: 'view.sidebar.left', title: t('commands.leftSidebar'), run: toggleLeftSidebar },
    { id: 'view.sidebar.right', title: t('commands.rightSidebar'), run: toggleRightSidebar },
    { id: 'theme.toggle', title: t('commands.theme'), run: toggleTheme },
  ]), [
    commandPalette.toggle, config, createCanvas, createNewFile, openGraph, search.show, settings.show,
    templates.show, toggleFocusMode, toggleLeftSidebar, toggleRightSidebar, toggleTheme,
    workspaces.show, workspacePath, openBoards, openNewBoard, addCurrentNoteToBoard, activeFile, kanbanEnabled,
    openJournalToday, openTypePicker, gallery.show,
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
    const activePdfPath = paneActiveTab?.kind === 'document' && isPdfPath(paneActiveTab.path)
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
              <main className={graphActive ? 'q-app-editor q-offstage' : 'q-app-editor'}>
                {activeBasePath && (
                  <Suspense fallback={null}>
                    <BaseView
                      path={activeBasePath}
                      workspacePath={workspacePath}
                      indexReady={linkIndexReady}
                      indexRevision={linkIndexRevision}
                      journalSettings={config?.journal ?? null}
                      onOpenNote={(path) => openNote(path, { paneId })}
                      onFileRenamed={handleFileRenamed}
                      onFileDeleted={closeTab}
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
                      inactive={false}
                      indexRevision={linkIndexRevision}
                      onOpenFile={(path) => openNote(path, { paneId })}
                      onOpenNoteLink={(link, sourcePath) => openCanvasNote(link, paneId, activeCanvasPath, sourcePath).catch(() => undefined)}
                    />
                  </Suspense>
                )}
                {activePdfPath && workspacePath && (
                  <Suspense fallback={<div className="q-app-editor-boot" aria-busy="true" />}>
                    <PdfViewer path={activePdfPath} workspacePath={workspacePath} />
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
                {livePanes.filter((tab) => tab.paneId === paneId && !(activeCanvasPath && tab.tabId === paneActiveTab?.tabId)).map((tab) => (
                  isCanvasPath(tab.path) ? (
                    <Suspense key={`${tab.tabId}:${tab.path}`} fallback={null}>
                      <CanvasView
                        path={tab.path}
                        workspacePath={workspacePath ?? ''}
                        inactive={tab.tabId !== paneActiveTab?.tabId}
                        indexRevision={linkIndexRevision}
                        onOpenFile={(path) => openNote(path, { paneId })}
                        onOpenNoteLink={(link, sourcePath) => openCanvasNote(link, paneId, tab.path, sourcePath).catch(() => undefined)}
                      />
                    </Suspense>
                  ) : isTextFilePath(tab.path) && !isMarkdownPath(tab.path) ? (
                    <TextFilePane
                      key={`${tab.tabId}:${tab.path}`}
                      path={tab.path}
                      inactive={tab.tabId !== paneActiveTab?.tabId}
                    />
                  ) : (
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
                  )
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
      <div
        className="q-app-workspace"
        style={{
          '--q-sidebar-width': `${leftWidth}px`,
          '--q-backlinks-width': `${rightWidth}px`,
        } as CSSProperties}
      >
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
          onOpenCanvas={focusMode ? undefined : openCanvas}
          canvasActive={Boolean(activeFile && isCanvasPath(activeFile))}
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
          onBoardRenamed={handleFileRenamed}
          boardActionRequest={boardActionRequest}
          onBoardActionRequestComplete={() => setBoardActionRequest(null)}
          createBoardRequest={createBoardRequest}
          onAddToBoard={kanbanEnabled ? (path) => requestBoardAction(path, 'add') : undefined}
          onRemoveFromBoard={kanbanEnabled ? removeNoteFromBoard : undefined}
        />
        {leftSidebarVisible && (
          <PanelResizer
            side="left"
            width={leftWidth}
            label={t('layout.resizeLeftPanel')}
            onResize={setLeftWidth}
            onReset={() => setLeftWidth(PANEL_LIMITS.left.fallback)}
          />
        )}

        {panesEnabled ? (
          <PaneLayoutView layout={visiblePaneLayout} renderPane={renderPane} onResize={(path, ratio) => resizePane(path, ratio)} />
        ) : renderPane(activePaneId)}
        {rightSidebarVisible && (
          <PanelResizer
            side="right"
            width={rightWidth}
            label={t('layout.resizeRightPanel')}
            onResize={setRightWidth}
            onReset={() => setRightWidth(PANEL_LIMITS.right.fallback)}
          />
        )}
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

      <TypePickerDialog
        open={typePicker.open}
        workspacePath={workspacePath}
        path={typeTarget?.path ?? null}
        currentType={typeTarget?.currentType ?? null}
        onClose={typePicker.hide}
        onSelect={applyNoteType}
      />

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

      <GalleryDialog
        open={gallery.open}
        workspacePath={workspacePath}
        onClose={gallery.hide}
      />
    </div>
  );
}
