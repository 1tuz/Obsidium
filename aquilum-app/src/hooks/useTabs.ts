import { useCallback, useMemo, useReducer } from 'react';
import { GRAPH_TAB_PATH, tabsReducer, type TabsState } from '../modules/ui-state';
import {
  createEmptySessionTab,
  createGraphSessionTab,
  createLinkedFile as createLinkedFileOnDisk,
} from './tabWorkspace';
import { createUniqueFile } from '../modules/documents/documentFactory';
import { useTabSession } from './useTabSession';
import { isBasePath, isMarkdownPath } from '../modules/documents/fileGateway';
import type { LinkDisposition } from '../modules/links';
import { paneLeaves } from '../modules/panes/layout';

function createInitialState(): TabsState {
  const tab = createEmptySessionTab();
  return {
    tabs: [tab],
    activeTabId: tab.tabId,
    layout: { kind: 'pane', paneId: 'main', activeTabId: tab.tabId },
  };
}

export function useTabs(
  workspacePath: string | null,
  workspaceReady: boolean,
) {
  const [state, dispatch] = useReducer(
    tabsReducer,
    undefined,
    createInitialState,
  );
  const {
    touch,
    trackRename,
    loadedView,
    isViewLoaded,
    queueView,
    readGraphCamera,
    queueGraphCamera,
    sessionReady,
    viewRevision,
    stateError,
  } = useTabSession({
    workspacePath,
    workspaceReady,
    state,
    dispatch,
  });

  const pathsByTabId = useMemo(
    () => new Map(state.tabs.map((tab) => [tab.tabId, tab.path])),
    [state.tabs],
  );
  const activeFile = pathsByTabId.get(state.activeTabId) ?? null;
  const activePaneId = state.tabs.find((tab) => tab.tabId === state.activeTabId)?.paneId ?? 'main';

  const openGraph = useCallback(() => {
    touch();
    dispatch({ type: 'open-graph', tab: createGraphSessionTab() });
  }, [touch]);

  const activateFile = useCallback((
    path: string,
    options?: { disposition?: LinkDisposition; paneId?: string },
  ) => {
    if (path === GRAPH_TAB_PATH) {
      openGraph();
      return;
    }
    const disposition = options?.disposition ?? 'current';
    const paneId = options?.paneId ?? activePaneId;
    const existing = disposition === 'current'
      ? state.tabs.find((tab) => tab.paneId === paneId && tab.path === path)
      : undefined;
    if (existing) {
      touch();
      dispatch({ type: 'select', tabId: existing.tabId, paneId });
      return;
    }
    if (!isMarkdownPath(path) && !isBasePath(path)) return;
    touch();
    if (paneId !== activePaneId) dispatch({ type: 'focus-pane', paneId });
    dispatch(disposition === 'new-tab'
      ? { type: 'open-file-new-tab', path, tabId: crypto.randomUUID() }
      : { type: 'open-file', path, tabId: crypto.randomUUID() });
  }, [activePaneId, openGraph, state.tabs, touch]);

  const closeTab = useCallback((path: string, tabId?: string) => {
    touch();
    const closing = tabId ? state.tabs.filter((tab) => tab.tabId === tabId) : state.tabs.filter((tab) => tab.path === path);
    for (const tab of closing) {
      dispatch({ type: 'close', tabId: tab.tabId, fallback: createEmptySessionTab(tab.paneId) });
    }
  }, [state.tabs, touch]);

  const reorderTabs = useCallback((from: number, to: number, paneId = activePaneId) => {
    touch();
    dispatch({ type: 'reorder', from, to, paneId });
  }, [activePaneId, touch]);

  const newTab = useCallback((paneId = activePaneId) => {
    touch();
    if (paneId !== activePaneId) dispatch({ type: 'focus-pane', paneId });
    dispatch({ type: 'new-tab', tab: createEmptySessionTab(paneId) });
  }, [activePaneId, touch]);

  const splitPane = useCallback((paneId: string, direction: 'horizontal' | 'vertical') => {
    const pane = paneLeaves(state.layout).find((item) => item.paneId === paneId);
    if (!pane) return;
    const current = state.tabs.find((tab) => tab.tabId === pane.activeTabId);
    const newPaneId = crypto.randomUUID();
    const duplicate = current
      ? { ...current, tabId: crypto.randomUUID(), paneId: newPaneId, mountKey: crypto.randomUUID() }
      : createEmptySessionTab(newPaneId);
    touch();
    dispatch({ type: 'focus-pane', paneId });
    dispatch({ type: 'split-pane', paneId, newPaneId, direction, tab: duplicate });
  }, [state.layout, state.tabs, touch]);

  const moveTab = useCallback((tabId: string, paneId: string, beforeTabId: string | null) => {
    const targetTabs = state.tabs.filter((tab) => tab.paneId === paneId && tab.tabId !== tabId);
    const to = beforeTabId ? targetTabs.findIndex((tab) => tab.tabId === beforeTabId) : targetTabs.length;
    const moving = state.tabs.find((tab) => tab.tabId === tabId);
    if (!moving) return;
    touch();
    dispatch({ type: 'move-tab', tabId, paneId, to, fallback: createEmptySessionTab(moving.paneId) });
  }, [state.tabs, touch]);

  const removePane = useCallback((paneId: string) => {
    const targetPaneId = paneLeaves(state.layout).find((pane) => pane.paneId !== paneId)?.paneId;
    if (!targetPaneId) return;
    touch();
    dispatch({ type: 'remove-pane', paneId, targetPaneId });
  }, [state.layout, touch]);

  const resizePane = useCallback((path: readonly number[], ratio: number) => {
    dispatch({ type: 'resize-pane', path, ratio });
  }, []);

  const focusPane = useCallback((paneId: string) => {
    dispatch({ type: 'focus-pane', paneId });
  }, []);

  const selectTab = useCallback((tabId: string, paneId: string) => {
    dispatch({ type: 'select', tabId, paneId });
  }, []);

  const createNewFile = useCallback(async (preferredTitle?: string) => {
    if (!workspacePath) return;
    const uniquePath = await createUniqueFile(workspacePath, preferredTitle);
    if (!uniquePath) return;
    touch();
    if (state.tabs.find((tab) => tab.tabId === state.activeTabId)?.paneId !== activePaneId) {
      dispatch({ type: 'focus-pane', paneId: activePaneId });
    }
    dispatch({ type: 'open-file', path: uniquePath, tabId: crypto.randomUUID() });
  }, [activePaneId, state.activeTabId, state.tabs, touch, workspacePath]);

  const createFromTemplate = useCallback(async (content: string) => {
    if (!workspacePath) return;
    const path = await createUniqueFile(workspacePath, undefined, content);
    if (!path) return;
    touch(); dispatch({ type: 'open-file', path, tabId: crypto.randomUUID() });
  }, [touch, workspacePath]);

  const createLinkedFile = useCallback(async (target: string) => {
    if (!workspacePath) return null;
    return createLinkedFileOnDisk(workspacePath, target);
  }, [workspacePath]);

  const handleExternalRename = useCallback((oldPath: string, newPath: string) => {
    if (!state.tabs.some((tab) => tab.path === oldPath)) return;
    touch();
    trackRename(state.tabs.find((tab) => tab.path === oldPath), newPath);
    dispatch({ type: 'rename', oldPath, newPath });
  }, [state.tabs, touch, trackRename]);

  return {
    tabs: state.tabs,
    activeFile,
    activeTabId: state.activeTabId,
    activePaneId,
    layout: state.layout,
    sessionReady,
    viewRevision,
    stateError,
    loadedView,
    isViewLoaded,
    onViewStateChange: queueView,
    readGraphCamera,
    onGraphCameraChange: queueGraphCamera,
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
    createNewFile,
    createFromTemplate,
    createLinkedFile,
    handleExternalRename,
  };
}
