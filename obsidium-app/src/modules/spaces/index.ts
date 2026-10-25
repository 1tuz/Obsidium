import { invoke } from '@tauri-apps/api/core';
import { isMarkdownPath, type WorkspaceItem } from '../documents/fileGateway';
import { comparablePath, fileName, fileStem, parentDirectory } from '../paths';

export interface Space {
  id: string;
  name: string;
  root: string;
  includeTags: string[];
  excludeFolders: string[];
}

export const DEFAULT_SPACE_ID = 'all';

interface DirectoryLink {
  absolute: string;
  relative: string;
}

export function getSpaces(): Promise<Space[]> {
  return invoke<Space[]>('get_spaces');
}

export function saveSpace(space: Space): Promise<Space> {
  return invoke<Space>('save_space', { space });
}

export function deleteSpace(id: string): Promise<Space[]> {
  return invoke<Space[]>('delete_space', { id });
}

export function listSpaceFiles(workspacePath: string, spaceId: string | null): Promise<string[]> {
  return invoke<string[]>('list_space_files', { workspacePath, spaceId });
}

export function isWholeVaultSpace(space: Space | null): boolean {
  if (!space) return true;
  return space.root === ''
    && space.includeTags.length === 0
    && space.excludeFolders.length === 0;
}

function directoryChain(workspacePath: string, directory: string): DirectoryLink[] | null {
  const root = comparablePath(workspacePath);
  if (!root || !directory) return null;
  const levels: DirectoryLink[] = [];
  let current = directory;
  while (comparablePath(current) !== root) {
    const key = comparablePath(current);
    if (!key.startsWith(`${root}/`)) return null;
    levels.unshift({ absolute: current, relative: fileName(current) });
    const parent = parentDirectory(current);
    if (!parent || parent === current) return null;
    current = parent;
  }
  return levels.map((level, index) => ({
    absolute: level.absolute,
    relative: levels.slice(0, index + 1).map((entry) => entry.relative).join('/'),
  }));
}

function isInsideWorkspace(root: string, path: string): boolean {
  const key = comparablePath(path);
  if (!key.startsWith(`${root}/`)) return false;
  return !key.slice(root.length + 1).split('/').some((segment) => segment === '.' || segment === '..');
}

function compareItems(left: WorkspaceItem, right: WorkspaceItem): number {
  if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
  const leftName = left.name.toLowerCase();
  const rightName = right.name.toLowerCase();
  if (leftName === rightName) return 0;
  return leftName < rightName ? -1 : 1;
}

export function buildSpaceDirectories(
  workspacePath: string,
  paths: string[],
): Map<string, WorkspaceItem[]> {
  const directories = new Map<string, WorkspaceItem[]>();
  const root = comparablePath(workspacePath);
  if (!root) return directories;
  directories.set(workspacePath, []);
  const folders = new Set<string>([root]);
  const files = new Set<string>();

  for (const path of paths) {
    const fileKey = comparablePath(path);
    if (!isInsideWorkspace(root, path) || files.has(fileKey)) continue;
    const chain = directoryChain(workspacePath, parentDirectory(path));
    if (!chain) continue;
    files.add(fileKey);

    let parentKey = workspacePath;
    for (const link of chain) {
      const folderKey = comparablePath(link.absolute);
      if (!folders.has(folderKey)) {
        folders.add(folderKey);
        directories.get(parentKey)?.push({
          id: link.absolute,
          name: fileName(link.absolute),
          type: 'folder',
        });
        directories.set(link.absolute, []);
      }
      parentKey = link.absolute;
    }
    directories.get(parentKey)?.push({
      id: path,
      name: isMarkdownPath(path) ? fileStem(path) : fileName(path),
      type: 'file',
    });
  }

  for (const items of directories.values()) items.sort(compareItems);
  return directories;
}

export function folderOptions(workspacePath: string, paths: string[]): string[] {
  const root = comparablePath(workspacePath);
  if (!root) return [];
  const folders = new Set<string>();
  for (const path of paths) {
    if (!isInsideWorkspace(root, path)) continue;
    const chain = directoryChain(workspacePath, parentDirectory(path));
    if (!chain) continue;
    for (const link of chain) folders.add(link.relative);
  }
  return [...folders].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
