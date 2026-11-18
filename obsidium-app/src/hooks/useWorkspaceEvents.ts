import { useEffect, useRef } from 'react';
import type { WorkspaceItem } from '../modules/documents/fileGateway';
import { comparablePath, parentDirectory } from '../modules/paths';
import { forgetAttachmentUrls } from '../modules/docs/vaultAttachments';
import { useTauriEvent } from './useTauriEvent';

export const WORKSPACE_CHANGED_EVENT = 'workspace-changed';
export const WORKSPACE_RESCAN_EVENT = 'workspace-rescan';
const EVENT_DELAY_MS = 60;
const REFRESH_CONCURRENCY = 4;

interface WorkspaceEventsOptions {
  workspacePath: string | null;
  directories: ReadonlyMap<string, WorkspaceItem[]>;
  refreshDirectory: (path: string) => Promise<boolean>;
  pruneDirectories: () => void;
}

export function useWorkspaceEvents(options: WorkspaceEventsOptions): void {
  const optionsRef = useRef(options);
  const changedPathsRef = useRef(new Set<string>());
  const rescanRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  optionsRef.current = options;

  useEffect(() => {
    mountedRef.current = true;
    const changedPaths = changedPathsRef.current;
    const rescan = rescanRef;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      changedPaths.clear();
      rescan.current = false;
    };
  }, []);

  const schedule = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const rescan = rescanRef.current;
      rescanRef.current = false;
      void refreshChanged(changedPathsRef.current, optionsRef.current, mountedRef, rescan);
    }, EVENT_DELAY_MS);
  };

  useTauriEvent<string[]>(WORKSPACE_CHANGED_EVENT, (paths) => {
    forgetAttachmentUrls();
    paths.forEach((path) => changedPathsRef.current.add(path));
    schedule();
  });

  useTauriEvent<null>(WORKSPACE_RESCAN_EVENT, () => {
    forgetAttachmentUrls();
    rescanRef.current = true;
    schedule();
  });
}

async function refreshChanged(
  changedPaths: Set<string>,
  options: WorkspaceEventsOptions,
  mounted: { current: boolean },
  rescan: boolean,
): Promise<void> {
  const changed = [...changedPaths];
  changedPaths.clear();
  const targets = directoriesToRefresh(options.workspacePath, options.directories, changed, rescan);
  await runBounded(targets, options.refreshDirectory);
  if (mounted.current) options.pruneDirectories();
}

export function directoriesToRefresh(
  workspacePath: string | null,
  directories: ReadonlyMap<string, WorkspaceItem[]>,
  changedPaths: string[],
  rescan: boolean,
): string[] {
  if (rescan) return [...directories.keys()];
  return affectedDirectories(workspacePath, directories, changedPaths);
}

export function affectedDirectories(
  workspacePath: string | null,
  directories: ReadonlyMap<string, WorkspaceItem[]>,
  changedPaths: string[],
): string[] {
  if (!workspacePath) return [];
  const loaded = new Map([...directories.keys()].map((path) => [comparablePath(path), path]));
  const root = comparablePath(workspacePath);
  const targets = new Set<string>();
  for (const changed of changedPaths) {
    const normalized = comparablePath(changed);
    if (normalized === root) {
      const target = loaded.get(root);
      if (target) targets.add(target);
      continue;
    }
    const parent = parentDirectory(normalized);
    const target = loaded.get(parent) ?? ancestorMissingTheBranch(directories, loaded, root, parent);
    if (target) targets.add(target);
  }
  return [...targets];
}

function ancestorMissingTheBranch(
  directories: ReadonlyMap<string, WorkspaceItem[]>,
  loaded: ReadonlyMap<string, string>,
  root: string,
  unloadedParent: string,
): string | undefined {
  let branch = unloadedParent;
  let directory = parentDirectory(branch);
  while (directory.length >= root.length) {
    const ancestor = loaded.get(directory);
    if (ancestor) {
      const items = directories.get(ancestor) ?? [];
      const alreadyListed = items.some((item) => comparablePath(item.id) === branch);
      return alreadyListed ? undefined : ancestor;
    }
    branch = directory;
    directory = parentDirectory(directory);
  }
  return undefined;
}

async function runBounded(
  paths: string[],
  operation: (path: string) => Promise<boolean>,
): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (cursor < paths.length) {
      const path = paths[cursor];
      cursor += 1;
      await operation(path);
    }
  };
  await Promise.all(Array.from({ length: Math.min(paths.length, REFRESH_CONCURRENCY) }, worker));
}

