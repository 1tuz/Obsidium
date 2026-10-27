import { t } from '../../i18n';
import type { MenuItem } from '../Common/Menu';
import { isBasePath, isMarkdownPath } from '../../modules/documents/fileGateway';

export type FileKind = 'file' | 'folder';

export interface FileMenuActions {
  startRename: (path: string) => void;
  duplicateFile: (path: string) => void;
  requestDelete: (path: string) => void;
  addToBoard?: (path: string) => void;
  removeFromBoard?: (path: string) => void;
  openAsText?: (path: string) => void;
  createNoteIn?: (path: string) => void;
  createFolderIn?: (path: string) => void;
}

export function renameItem(onSelect: () => void): MenuItem {
  return { id: 'rename', label: t('common.rename'), onSelect };
}

function deleteItem(onSelect: () => void): MenuItem {
  return { id: 'delete', label: t('common.delete'), onSelect };
}

function creationItems(actions: FileMenuActions, path: string): MenuItem[] {
  const items: MenuItem[] = [];
  if (actions.createNoteIn) {
    items.push({
      id: 'new-note-here',
      label: t('fileTree.newNoteHere'),
      onSelect: () => actions.createNoteIn?.(path),
    });
  }
  if (actions.createFolderIn) {
    items.push({
      id: 'new-folder-here',
      label: t('fileTree.newFolderHere'),
      onSelect: () => actions.createFolderIn?.(path),
    });
  }
  return items;
}

export function rootActionItems(actions: FileMenuActions, path: string): MenuItem[] {
  const items: MenuItem[] = [];
  if (actions.createNoteIn) {
    items.push({
      id: 'new-note',
      label: t('fileTree.createNote'),
      onSelect: () => actions.createNoteIn?.(path),
    });
  }
  if (actions.createFolderIn) {
    items.push({
      id: 'new-folder',
      label: t('fileTree.createFolder'),
      onSelect: () => actions.createFolderIn?.(path),
    });
  }
  return items;
}

function folderItems(actions: FileMenuActions, path: string): MenuItem[] {
  return [
    ...creationItems(actions, path),
    renameItem(() => actions.startRename(path)),
    deleteItem(() => actions.requestDelete(path)),
  ];
}

export function fileActionItems(
  actions: FileMenuActions,
  path: string,
  kind: FileKind = 'file',
): MenuItem[] {
  if (kind === 'folder') return folderItems(actions, path);

  return [
    renameItem(() => actions.startRename(path)),
    { id: 'duplicate', label: t('common.duplicate'), onSelect: () => actions.duplicateFile(path) },
    ...(isMarkdownPath(path) && actions.addToBoard ? [{
      id: 'add-to-board', label: t('boards.addToBoard'), onSelect: () => actions.addToBoard?.(path),
    }] : []),
    ...(isMarkdownPath(path) && actions.removeFromBoard ? [{
      id: 'remove-from-board', label: t('boards.removeFromBoard'), onSelect: () => actions.removeFromBoard?.(path),
    }] : []),
    ...(isBasePath(path) && actions.openAsText ? [{
      id: 'open-as-text', label: t('common.openAsText'), onSelect: () => actions.openAsText?.(path),
    }] : []),
    deleteItem(() => actions.requestDelete(path)),
  ];
}
