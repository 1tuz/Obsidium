import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { existingFiles } from '../modules/documents/fileGateway';
import {
  WorkspaceSession,
  stateFailure,
  type StateFailure,
  type GraphCameraState,
  type SessionTab,
  type TabsAction,
  type TabsState,
  type ViewState,
} from '../modules/ui-state';
import { loadTabSessionCache, saveTabSessionCache } from '../modules/workspace/uiPersist';
import { comparablePath } from '../modules/paths';
import { createEmptySessionTab } from './tabWorkspace';
import { paneLeaves } from '../modules/panes/layout';

interface UseTabSessionInput {
  workspacePath: string | null;
  workspaceReady: boolean;
  state: TabsState;
  dispatch: Dispatch<TabsAction>;
}

export function useTabSession({
  workspacePath,
  workspaceReady,
  state,
  dispatch,
}: UseTabSessionInput) {
  const [revision, setRevision] = useState(0);
  const [viewRevision, setViewRevision] = useState(0);
  const [sessionReady, setSessionReady] = useState(false);
  const sessionRef = useRef<WorkspaceSession | null>(null);
  const touchedRef = useRef(false);
  const generationRef = useRef(0);
  const prevWorkspaceRef = useRef<string | null | undefined>(undefined);
  const resolvingRef = useRef(new Set<string>());
  const [stateError, setStateError] = useState<StateFailure | null>(null);
  const degrade = useCallback((error: unknown, sessionFailed = false) => {
    setStateError((current) => current ?? stateFailure(error, sessionFailed));
  }, []);

  useEffect(() => {
    const prev = prevWorkspaceRef.current;
    prevWorkspaceRef.current = workspacePath;
    if (prev === undefined || prev === workspacePath) return;
    generationRef.current += 1;
    sessionRef.current?.dispose();
    sessionRef.current = null;
    resolvingRef.current.clear();
    setStateError(null);
    touchedRef.current = false;
    setSessionReady(false);
    const cached = workspacePath ? loadTabSessionCache(workspacePath) : null;
    if (cached) {
      dispatch({ type: 'restore', tabs: cached.tabs, activeTabId: cached.activeTabId, layout: cached.layout });
      return;
    }
    dispatch({ type: 'reset', tab: createEmptySessionTab() });
  }, [dispatch, workspacePath]);

  useEffect(() => {
    if (!workspacePath || !workspaceReady) return;
    const generation = ++generationRef.current;
    let opened: WorkspaceSession | null = null;
    let cancelled = false;
    void WorkspaceSession.open(workspacePath).then(async (session) => {
      opened = session;
      const loaded = session.restoredTabs();
      const documentPaths = loaded
        .filter((tab) => tab.kind === 'document')
        .map((tab) => tab.path);
      const available = new Set((await existingFiles(documentPaths)).map(comparablePath));
      if (cancelled || generation !== generationRef.current) {
        session.dispose();
        return;
      }
      sessionRef.current = session;
      const restored = WorkspaceSession.restorable(
        loaded,
        (path) => available.has(comparablePath(path)),
      );
      const restoredPanes = new Set(restored.map((tab) => tab.paneId));
      const fallbackTabs = paneLeaves(session.loaded.layout)
        .filter((pane) => !restoredPanes.has(pane.paneId))
        .map((pane) => createEmptySessionTab(pane.paneId));
      for (const tab of loaded) {
        if (isMissingDocument(tab, available)) {
          void session.markDocumentMissing(tab.documentId!)
            .catch((error) => console.error('Failed to mark missing document', error));
        }
      }
      if (!touchedRef.current && (restored.length > 0 || fallbackTabs.length > 0)) {
        const activeTabId = restored.some((tab) => tab.tabId === session.loaded.activeTabId)
          ? session.loaded.activeTabId!
          : restored[0]?.tabId ?? fallbackTabs[0].tabId;
        dispatch({
          type: 'restore',
          tabs: restored,
          activeTabId,
          layout: session.loaded.layout,
          fallbackTabs,
        });
      }
      setRevision((value) => value + 1);
      setSessionReady(true);
    }).catch((error) => {
      opened?.dispose();
      console.error('Failed to restore workspace session', error);
      if (!cancelled && generation === generationRef.current) {
        degrade(error, true);
        setSessionReady(true);
      }
    });
    return () => {
      cancelled = true;
      opened?.dispose();
    };
  }, [dispatch, workspacePath, workspaceReady]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    for (const tab of state.tabs) {
      const identityPath = tab.identityPath ?? tab.path;
      if (tab.kind !== 'document' || tab.documentId) continue;
      const key = `${tab.tabId}\0${identityPath}\0${tab.path}`;
      if (resolvingRef.current.has(key)) continue;
      resolvingRef.current.add(key);
      void session.resolveDocument(identityPath, tab.path).then((documentId) => {
        if (sessionRef.current === session) {
          dispatch({ type: 'resolve-identity', tabId: tab.tabId, path: tab.path, documentId });
        }
      }).catch((error) => {
        console.error('Failed to resolve document identity', error);
        if (sessionRef.current === session) degrade(error);
      }).finally(() => resolvingRef.current.delete(key));
    }
  }, [degrade, dispatch, revision, state.tabs, stateError]);

  const unresolved = useMemo(
    () => state.tabs.some((tab) => tab.kind === 'document' && !tab.documentId),
    [state.tabs],
  );

  const activeDocuments = useMemo(() => paneLeaves(state.layout).flatMap((pane) => {
    const tab = state.tabs.find((candidate) => candidate.tabId === pane.activeTabId);
    return tab?.kind === 'document' && tab.documentId
      ? [{ documentId: tab.documentId, paneId: pane.paneId }]
      : [];
  }), [state.layout, state.tabs]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session || activeDocuments.length === 0 || stateError !== null) return;
    let cancelled = false;
    void Promise.all(activeDocuments.map(({ documentId, paneId }) => (
      session.ensureViewLoaded(documentId, paneId)
    ))).then(() => {
      if (!cancelled && sessionRef.current === session) setViewRevision((value) => value + 1);
    }).catch((error) => {
      console.error('Failed to load document view', error);
      if (!cancelled && sessionRef.current === session) degrade(error);
    });
    return () => {
      cancelled = true;
    };
  }, [activeDocuments, degrade, revision, stateError]);

  useEffect(() => {
    if (unresolved) return;
    sessionRef.current?.queueTabsSnapshot(state.tabs, state.activeTabId, state.layout);
    previousTabsRef.current = state.tabs;
  }, [revision, state.tabs, unresolved]);

  useEffect(() => {
    if (unresolved) return;
    sessionRef.current?.queueActiveTab(state.activeTabId);
  }, [revision, state.activeTabId, unresolved]);

  const layoutGeometry = useMemo(() => {
    const shape = (layout: TabsState['layout']): unknown => layout.kind === 'pane'
      ? ['pane', layout.paneId]
      : ['split', layout.direction, layout.ratio, shape(layout.children[0]), shape(layout.children[1])];
    return JSON.stringify(shape(state.layout));
  }, [state.layout]);
  const previousTabsRef = useRef(state.tabs);
  const currentLayoutRef = useRef(state.layout);
  const currentActiveTabIdRef = useRef(state.activeTabId);
  const currentTabsRef = useRef(state.tabs);
  currentLayoutRef.current = state.layout;
  currentActiveTabIdRef.current = state.activeTabId;
  currentTabsRef.current = state.tabs;

  useEffect(() => {
    const tabsChanged = previousTabsRef.current !== currentTabsRef.current;
    if (unresolved || tabsChanged) return;
    sessionRef.current?.queueLayout(currentActiveTabIdRef.current, currentLayoutRef.current);
  }, [layoutGeometry, revision, unresolved]);

  useEffect(() => {
    if (unresolved || !workspacePath || !sessionReady) return;
    saveTabSessionCache(workspacePath, state.tabs, state.activeTabId, state.layout);
  }, [revision, sessionReady, state.activeTabId, state.layout, state.tabs, unresolved, workspacePath]);

  const touch = useCallback(() => {
    touchedRef.current = true;
  }, []);

  const trackRename = useCallback((tab: SessionTab | undefined, newPath: string) => {
    if (!tab?.documentId) return;
    void sessionRef.current?.renameDocument(tab.documentId, newPath)
      .catch((error) => console.error('Failed to track document rename', error));
  }, []);

  const loadedView = useCallback((documentId: string, paneId: string) => {
    return sessionRef.current?.loadedView(documentId, paneId) ?? null;
  }, []);

  const isViewLoaded = useCallback((documentId: string, paneId: string) => {
    return sessionRef.current?.isViewLoaded(documentId, paneId) ?? false;
  }, []);

  const queueView = useCallback((view: ViewState) => {
    sessionRef.current?.queueView(view);
  }, []);

  const queueGraphCamera = useCallback((camera: GraphCameraState) => {
    sessionRef.current?.queueGraphCamera(camera);
  }, []);

  const readGraphCamera = useCallback(() => sessionRef.current?.graphCamera() ?? null, []);

  return {
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
  };
}

function isMissingDocument(tab: SessionTab, available: Set<string>): boolean {
  return tab.kind === 'document'
    && !!tab.documentId
    && !available.has(comparablePath(tab.path));
}
