import type { WorkspaceItem } from '../../modules/documents/fileGateway';
import type { FileMenuActions } from './fileActionItems';
import { comparablePath, fileName, isInsidePath, parentDirectory, samePath } from '../../modules/paths';

export interface VisibleFileRow {
  item: WorkspaceItem;
  comparableId: string;
  depth: number;
  expanded: boolean;
  loading: boolean;
  guideDepths: string;
}

export interface FileTreeActions extends FileMenuActions {
  selectFile: (path: string, isMulti: boolean, isRange: boolean) => void;
  openInNewTab: (path: string) => void;
  focusRow: (path: string) => void;
  targetsFor: (path: string) => string[];
  toggleFolder: (id: string) => void;
  prefetchFolder: (id: string) => void;
  commitRename: (path: string, nextName: string, isFolder?: boolean) => void;
  cancelRename: () => void;
}

export function parseGuideDepths(guideDepths: string): number[] {
  return guideDepths === '' ? [] : guideDepths.split(',').map(Number);
}

export function buildVisibleFileRows(
  roots: readonly WorkspaceItem[],
  directories: ReadonlyMap<string, WorkspaceItem[]>,
  expandedFolders: ReadonlySet<string>,
  loadingDirectories: ReadonlySet<string>,
  workspacePath?: string | null,
  createdItem?: WorkspaceItem | null,
): VisibleFileRow[] {
  const rows: VisibleFileRow[] = [];
  let visibleRoots = roots;
  let visibleDirectories = directories;
  let visibleExpandedFolders = expandedFolders;

  if (workspacePath && createdItem) {
    const parent = parentDirectory(createdItem.id);
    if (samePath(parent, workspacePath)) {
      if (!roots.some((item) => comparablePath(item.id) === comparablePath(createdItem.id))) {
        visibleRoots = [...roots, createdItem];
      }
    } else if (isInsidePath(parent, workspacePath)) {
      const ancestors: string[] = [];
      let current = parent;
      while (isInsidePath(current, workspacePath)) {
        ancestors.unshift(current);
        const next = parentDirectory(current);
        if (!next || samePath(next, current)) break;
        current = next;
      }

      if (samePath(current, workspacePath)) {
        const mutableDirectories = new Map(directories);
        const mutableExpandedFolders = new Set(expandedFolders);
        let parentPath = workspacePath;
        for (const directory of ancestors) {
          const directoryKey = [...mutableDirectories.keys()].find((path) => samePath(path, directory));
          const parentKey = samePath(parentPath, workspacePath)
            ? undefined
            : [...mutableDirectories.keys()].find((path) => samePath(path, parentPath));
          const parentItems = parentKey ? mutableDirectories.get(parentKey) ?? [] : visibleRoots;
          if (!parentItems.some((item) => samePath(item.id, directory))) {
            const folder: WorkspaceItem = { id: directory, name: fileName(directory), type: 'folder' };
            if (parentKey) mutableDirectories.set(parentKey, [...parentItems, folder]);
            else visibleRoots = [...visibleRoots, folder];
          }
          if (!directoryKey) mutableDirectories.set(directory, []);
          mutableExpandedFolders.add(directory);
          parentPath = directory;
        }

        const parentKey = [...mutableDirectories.keys()].find((path) => samePath(path, parentPath));
        const parentItems = parentKey ? mutableDirectories.get(parentKey) ?? [] : [];
        if (!parentItems.some((item) => samePath(item.id, createdItem.id))) {
          mutableDirectories.set(parentKey ?? parentPath, [...parentItems, createdItem]);
        }
        visibleDirectories = mutableDirectories;
        visibleExpandedFolders = mutableExpandedFolders;
      }
    }
  }

  const visit = (items: readonly WorkspaceItem[], depth: number, continuingGuides: number[]) => {
    const guideDepths = continuingGuides.join(',');

    items.forEach((item, index) => {
      const isFolder = item.type === 'folder';
      const expanded = isFolder && visibleExpandedFolders.has(item.id);
      const isLast = index === items.length - 1;

      rows.push({
        item,
        comparableId: comparablePath(item.id),
        depth,
        expanded,
        loading: isFolder && loadingDirectories.has(item.id),
        guideDepths,
      });

      if (expanded) {
        const children = visibleDirectories.get(item.id);
        if (children && children.length > 0) {
          let guidesForChildren = [...continuingGuides];
          if (isLast) {
            guidesForChildren = guidesForChildren.filter(g => g !== depth - 1);
          }
          guidesForChildren.push(depth);
          visit(children, depth + 1, guidesForChildren);
        }
      }
    });
  };

  visit(visibleRoots, 0, []);
  return rows;
}

export function unloadedExpandedFolders(
  rows: readonly VisibleFileRow[],
  directories: ReadonlyMap<string, WorkspaceItem[]>,
): string[] {
  return rows
    .filter((row) => row.expanded && !directories.has(row.item.id))
    .map((row) => row.item.id);
}
