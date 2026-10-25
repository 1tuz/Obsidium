import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceItem } from '../modules/documents/fileGateway';
import {
  DEFAULT_SPACE_ID,
  buildSpaceDirectories,
  deleteSpace as deleteSpaceRequest,
  getSpaces,
  isWholeVaultSpace,
  listSpaceFiles,
  saveSpace as saveSpaceRequest,
  type Space,
} from '../modules/spaces';
import { useSettingsStore } from '../modules/settings';
import { useTauriEvent } from './useTauriEvent';
import { WORKSPACE_CHANGED_EVENT } from './useWorkspaceEvents';

const REFRESH_DELAY_MS = 60;

interface SpacesController {
  spaces: Space[];
  activeSpace: Space | null;
  activeSpaceId: string;
  directories: Map<string, WorkspaceItem[]> | null;
  files: WorkspaceItem[] | null;
  selectSpace: (id: string) => void;
  saveSpace: (space: Space) => Promise<Space>;
  deleteSpace: (id: string) => Promise<Space[]>;
}

export function useSpaces(workspacePath: string | null): SpacesController {
  const { config, updateConfig } = useSettingsStore();
  const configRef = useRef(config);
  configRef.current = config;
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState<string>(DEFAULT_SPACE_ID);
  const [directories, setDirectories] = useState<Map<string, WorkspaceItem[]> | null>(null);
  const [revision, setRevision] = useState(0);
  const generationRef = useRef(0);
  const pendingRef = useRef<{ key: string; promise: Promise<Map<string, WorkspaceItem[]>> } | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const applySpaces = useCallback((next: Space[]) => {
    setSpaces(next);
    setActiveSpaceId((current) => (
      next.some((space) => space.id === current) ? current : next[0]?.id ?? DEFAULT_SPACE_ID
    ));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSpaces()
      .then((loaded) => {
        if (!cancelled) applySpaces(loaded);
      })
      .catch((error) => console.error('Failed to load spaces', error));
    return () => {
      cancelled = true;
    };
  }, [applySpaces]);

  const activeSpace = useMemo(
    () => spaces.find((space) => space.id === activeSpaceId) ?? null,
    [activeSpaceId, spaces],
  );

  const refreshableRef = useRef(false);
  refreshableRef.current = Boolean(workspacePath) && activeSpace !== null && !isWholeVaultSpace(activeSpace);

  useTauriEvent<string[]>(WORKSPACE_CHANGED_EVENT, () => {
    if (!refreshableRef.current) return;
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      if (refreshableRef.current) setRevision((current) => current + 1);
    }, REFRESH_DELAY_MS);
  });

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
  }, []);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!workspacePath || !activeSpace || isWholeVaultSpace(activeSpace)) {
      setDirectories(null);
      return;
    }
    const key = `${workspacePath}\u0000${activeSpace.id}\u0000${revision}`;
    const pending = pendingRef.current;
    const request = pending?.key === key
      ? pending.promise
      : listSpaceFiles(workspacePath, activeSpace.id)
        .then((paths) => buildSpaceDirectories(workspacePath, paths));
    if (pending?.key !== key) pendingRef.current = { key, promise: request };
    void request.then((tree) => {
      if (pendingRef.current?.promise === request) pendingRef.current = null;
      if (generation === generationRef.current) setDirectories(tree);
    }).catch((error) => {
      if (pendingRef.current?.promise === request) pendingRef.current = null;
      if (generation !== generationRef.current) return;
      console.error('Failed to list space files', error);
      setDirectories(new Map());
    });
  }, [activeSpace, revision, workspacePath]);

  const applyFreshSpaces = useCallback((next: Space[]) => {
    applySpaces(next);
    setRevision((current) => current + 1);
    const current = configRef.current;
    if (!current) return;
    const nextConfig = { ...current, spaces: { spaces: next } };
    configRef.current = nextConfig;
    void updateConfig(nextConfig).catch((error) => {
      console.error('Failed to save spaces', error);
    });
  }, [applySpaces, updateConfig]);

  const saveSpace = useCallback(async (space: Space) => {
    const saved = await saveSpaceRequest(space);
    applyFreshSpaces(await getSpaces());
    return saved;
  }, [applyFreshSpaces]);

  const deleteSpace = useCallback(async (id: string) => {
    const next = await deleteSpaceRequest(id);
    applyFreshSpaces(next);
    return next;
  }, [applyFreshSpaces]);

  return useMemo(() => ({
    spaces,
    activeSpace,
    activeSpaceId,
    directories,
    files: workspacePath ? directories?.get(workspacePath) ?? null : null,
    selectSpace: setActiveSpaceId,
    saveSpace,
    deleteSpace,
  }), [activeSpace, activeSpaceId, deleteSpace, directories, saveSpace, spaces, workspacePath]);
}
