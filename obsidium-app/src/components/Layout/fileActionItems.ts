import { t } from '../../i18n';
import type { MenuItem } from '../Common/Menu';
import { isBasePath, isMarkdownPath } from '../../modules/documents/fileGateway';

export interface FileMenuActions {
  startRename: (path: string) => void;
  duplicateFile: (path: string) => void;
  requestDelete: (path: string) => void;
  addToBoard?: (path: string) => void;
  removeFromBoard?: (path: string) => void;
  openAsText?: (path: string) => void;
}

export function renameItem(onSelect: () => void): MenuItem {
  return { id: 'rename', label: t('common.rename'), onSelect };
}

export function fileActionItems(actions: FileMenuActions, path: string): MenuItem[] {
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
    { id: 'delete', label: t('common.delete'), onSelect: () => actions.requestDelete(path) },
  ];
}
