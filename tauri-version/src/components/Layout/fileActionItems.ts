import { Columns3 } from 'lucide';
import { isMarkdownPath } from '../../modules/documents/fileGateway';
import { t } from '../../i18n';
import type { MenuItem } from '../Common/Menu';

export interface FileMenuActions {
  startRename: (path: string) => void;
  duplicateFile: (path: string) => void;
  requestDelete: (path: string) => void;
  addToBoard?: (path: string) => void;
}

export function renameItem(onSelect: () => void): MenuItem {
  return { id: 'rename', label: t('common.rename'), onSelect };
}

export function fileActionItems(actions: FileMenuActions, path: string): MenuItem[] {
  return [
    renameItem(() => actions.startRename(path)),
    { id: 'duplicate', label: t('common.duplicate'), onSelect: () => actions.duplicateFile(path) },
    { id: 'delete', label: t('common.delete'), onSelect: () => actions.requestDelete(path) },
    ...(actions.addToBoard && isMarkdownPath(path)
      ? [{ id: 'add-to-board', label: t('boards.addToBoard'), icon: Columns3, onSelect: () => actions.addToBoard?.(path) }]
      : []),
  ];
}
