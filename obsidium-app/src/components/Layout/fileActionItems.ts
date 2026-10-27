import {
  ArrowRight,
  Copy,
  CopyPlus,
  ExternalLink,
  FilePlus,
  FileText,
  FolderOpen,
  FolderPlus,
  History,
  LayoutTemplate,
  Link,
  PanelRight,
  Pencil,
  Search,
  Trash2,
} from 'lucide';
import { t } from '../../i18n';
import type { MenuEntry, MenuItem } from '../Common/Menu';
import { isBasePath, isMarkdownPath } from '../../modules/documents/fileGateway';

export type FileKind = 'file' | 'folder';

export interface FileMenuActions {
  startRename?: (path: string) => void;
  duplicateFile?: (path: string) => void;
  requestDelete?: (path: string) => void;
  openFile?: (path: string) => void;
  openInNewTab?: (path: string) => void;
  openInRight?: (path: string) => void;
  copyPath?: (path: string) => void;
  copyPaths?: (path: string) => void;
  copyInternalLink?: (path: string) => void;
  reveal?: (path: string) => void;
  revealWorkspace?: () => void;
  openHistory?: (path: string) => void;
  moveToFolder?: (path: string) => void;
  canDuplicateSelection?: (path: string) => boolean;
  canMoveSelection?: (path: string) => boolean;
  searchVault?: () => void;
  searchInFolder?: (path: string) => void;
  collapseFolders?: () => void;
  createCanvasIn?: (path: string) => void;
  createTemplateIn?: (path: string) => void;
  createBaseIn?: (path: string) => void;
  createNoteIn?: (path: string, content?: string) => void | Promise<void>;
  createFolderIn?: (path: string) => void;
  addToBoard?: (path: string) => void;
  removeFromBoard?: (path: string) => void;
  openAsText?: (path: string) => void;
}

export function renameItem(onSelect: () => void): MenuItem {
  return { id: 'rename', label: t('common.rename'), icon: Pencil, onSelect };
}

function separator(id: string): MenuEntry {
  return { type: 'separator', id };
}

function grouped(groups: MenuEntry[][]): MenuEntry[] {
  return groups.filter((group) => group.length > 0).flatMap((group, index) => (
    index === 0 ? group : [separator(`separator-${index}`), ...group]
  ));
}

function deleteItem(onSelect: () => void): MenuItem {
  return {
    id: 'delete',
    label: t('common.delete'),
    icon: Trash2,
    danger: true,
    onSelect,
  };
}

function createItems(actions: FileMenuActions, path: string): MenuEntry[] {
  const items: MenuEntry[] = [];
  if (actions.createNoteIn) {
    items.push({
      id: 'new-note-here',
      label: t('fileTree.newNoteHere'),
      icon: FilePlus,
      onSelect: () => actions.createNoteIn?.(path),
    });
  }
  if (actions.createFolderIn) {
    items.push({
      id: 'new-folder-here',
      label: t('fileTree.newFolderHere'),
      icon: FolderPlus,
      onSelect: () => actions.createFolderIn?.(path),
    });
  }
  if (actions.createTemplateIn) {
    items.push({
      id: 'new-from-template-here',
      label: t('fileTree.createFromTemplate'),
      icon: LayoutTemplate,
      onSelect: () => actions.createTemplateIn?.(path),
    });
  }
  return items;
}

function pathItems(actions: FileMenuActions, path: string, canMove = true): MenuEntry[] {
  return [
    ...(actions.copyPath ? [{
      id: 'copy-path', label: t('fileTree.copyPath'), icon: Copy,
      onSelect: () => actions.copyPath?.(path),
    }] : []),
    ...(actions.reveal ? [{
      id: 'reveal', label: t('fileTree.reveal'), icon: FolderOpen,
      onSelect: () => actions.reveal?.(path),
    }] : []),
    ...(canMove && actions.moveToFolder ? [{
      id: 'move', label: t('fileTree.moveToFolder'), icon: ArrowRight,
      onSelect: () => actions.moveToFolder?.(path),
    }] : []),
  ];
}

function folderItems(actions: FileMenuActions, path: string): MenuEntry[] {
  return grouped([
    createItems(actions, path),
    [
      ...(actions.searchInFolder ? [{
        id: 'search-folder', label: t('fileTree.searchInFolder'), icon: Search,
        onSelect: () => actions.searchInFolder?.(path),
      }] : []),
      ...pathItems(actions, path),
    ],
    [
      ...(actions.startRename ? [renameItem(() => actions.startRename?.(path))] : []),
      ...(actions.requestDelete ? [deleteItem(() => actions.requestDelete?.(path))] : []),
    ],
  ]);
}

export function rootActionItems(actions: FileMenuActions, path: string): MenuEntry[] {
  return grouped([
    [
      ...(actions.createNoteIn ? [{
        id: 'new-note', label: t('fileTree.createNote'), icon: FilePlus,
        onSelect: () => actions.createNoteIn?.(path),
      }] : []),
      ...(actions.createFolderIn ? [{
        id: 'new-folder', label: t('fileTree.createFolder'), icon: FolderPlus,
        onSelect: () => actions.createFolderIn?.(path),
      }] : []),
    ],
    [
      ...(actions.createCanvasIn ? [{
        id: 'new-canvas', label: t('fileTree.createCanvas'), icon: FileText,
        onSelect: () => actions.createCanvasIn?.(path),
      }] : []),
      ...(actions.createTemplateIn ? [{
        id: 'new-from-template', label: t('fileTree.createFromTemplate'), icon: LayoutTemplate,
        onSelect: () => actions.createTemplateIn?.(path),
      }] : []),
      ...(actions.createBaseIn ? [{
        id: 'new-base', label: t('fileTree.createBase'), icon: FileText,
        onSelect: () => actions.createBaseIn?.(path),
      }] : []),
    ],
    actions.searchVault ? [{
      id: 'search-vault', label: t('fileTree.searchVault'), icon: Search,
      onSelect: actions.searchVault,
    }] : [],
    [
      ...(actions.collapseFolders ? [{
        id: 'collapse-folders', label: t('fileTree.collapseFolders'), icon: FolderOpen,
        onSelect: actions.collapseFolders,
      }] : []),
      ...(actions.revealWorkspace ? [{
        id: 'reveal-workspace', label: t('fileTree.revealWorkspace'), icon: ExternalLink,
        onSelect: actions.revealWorkspace,
      }] : []),
    ],
  ]);
}

export function selectionActionItems(actions: FileMenuActions, path: string): MenuEntry[] {
  return grouped([
    actions.copyPaths ? [{
      id: 'copy-paths', label: t('fileTree.copyPaths'), icon: Copy,
      onSelect: () => actions.copyPaths?.(path),
    }] : [],
    [
      ...(actions.duplicateFile && (actions.canDuplicateSelection?.(path) ?? true) ? [{
        id: 'duplicate-selection', label: t('common.duplicate'), icon: CopyPlus,
        onSelect: () => actions.duplicateFile?.(path),
      }] : []),
      ...(actions.moveToFolder && (actions.canMoveSelection?.(path) ?? true) ? [{
        id: 'move-selection', label: t('fileTree.moveToFolder'), icon: ArrowRight,
        onSelect: () => actions.moveToFolder?.(path),
      }] : []),
    ],
    actions.requestDelete ? [deleteItem(() => actions.requestDelete?.(path))] : [],
  ]);
}

export function fileActionItems(
  actions: FileMenuActions,
  path: string,
  kind: FileKind = 'file',
): MenuEntry[] {
  if (kind === 'folder') return folderItems(actions, path);
  const markdown = isMarkdownPath(path);
  const base = isBasePath(path);

  return grouped([
    [
      ...(actions.openFile ? [{
        id: 'open', label: t('fileTree.open'), icon: ExternalLink,
        onSelect: () => actions.openFile?.(path),
      }] : []),
      ...(markdown && actions.openInNewTab ? [{
        id: 'open-new-tab', label: t('fileTree.openInNewTab'), icon: CopyPlus,
        onSelect: () => actions.openInNewTab?.(path),
      }] : []),
      ...(markdown && actions.openInRight ? [{
        id: 'open-right', label: t('fileTree.openInRight'), icon: PanelRight,
        onSelect: () => actions.openInRight?.(path),
      }] : []),
      ...(base && actions.openAsText ? [{
        id: 'open-as-text', label: t('common.openAsText'), icon: FileText,
        onSelect: () => actions.openAsText?.(path),
      }] : []),
    ],
    [
      ...(markdown && actions.copyInternalLink ? [{
        id: 'copy-internal-link', label: t('fileTree.copyInternalLink'), icon: Link,
        onSelect: () => actions.copyInternalLink?.(path),
      }] : []),
      ...(actions.copyPath ? [{
        id: 'copy-path', label: t('fileTree.copyPath'), icon: Copy,
        onSelect: () => actions.copyPath?.(path),
      }] : []),
      ...(actions.reveal ? [{
        id: 'reveal', label: t('fileTree.reveal'), icon: FolderOpen,
        onSelect: () => actions.reveal?.(path),
      }] : []),
      ...(markdown && actions.openHistory ? [{
        id: 'history', label: t('fileTree.history'), icon: History,
        onSelect: () => actions.openHistory?.(path),
      }] : []),
    ],
    [
      ...(actions.duplicateFile ? [{
        id: 'duplicate', label: t('common.duplicate'), icon: CopyPlus,
        onSelect: () => actions.duplicateFile?.(path),
      }] : []),
      ...(actions.moveToFolder ? [{
        id: 'move', label: t('fileTree.moveToFolder'), icon: ArrowRight,
        onSelect: () => actions.moveToFolder?.(path),
      }] : []),
      ...(markdown && actions.addToBoard ? [{
        id: 'add-to-board', label: t('boards.addToBoard'), onSelect: () => actions.addToBoard?.(path),
      }] : []),
      ...(markdown && actions.removeFromBoard ? [{
        id: 'remove-from-board', label: t('boards.removeFromBoard'), onSelect: () => actions.removeFromBoard?.(path),
      }] : []),
    ],
    [
      ...(actions.startRename ? [renameItem(() => actions.startRename?.(path))] : []),
      ...(actions.requestDelete ? [deleteItem(() => actions.requestDelete?.(path))] : []),
    ],
  ]);
}
