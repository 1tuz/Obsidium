import { memo } from 'react';
import { FileText } from 'lucide';
import { FileTreeRow } from './FileTreeRow';
import { comparablePath } from '../../modules/paths';
import type { FileTreeActions, VisibleFileRow } from './fileTreeModel';
import type { FileIconAssignment } from './iconize';
import { rootActionItems } from './fileActionItems';
import { Button } from '../Common/Button';
import { EmptyState } from '../Common/EmptyState';
import { Menu } from '../Common/Menu';
import { t } from '../../i18n';
import { useContextMenu } from '../Common/useContextMenu';

interface FileTreeProps {
  rows: readonly VisibleFileRow[];
  activeFile: string | null;
  selectedFiles: ReadonlySet<string>;
  renamingPath: string | null;
  actions: FileTreeActions;
  rootPath?: string | null;
  error?: string | null;
  icons?: Record<string, FileIconAssignment>;
  onIconChange?: (path: string, icon: FileIconAssignment | null) => void;
}

export const FileTree = memo(function FileTree({
  rows,
  activeFile,
  selectedFiles,
  renamingPath,
  actions,
  rootPath,
  error,
  icons,
  onIconChange,
}: FileTreeProps) {
  const activePath = comparablePath(activeFile);
  const rootMenu = useContextMenu();
  const root = rootPath && (actions.createNoteIn || actions.createFolderIn) ? rootPath : null;

  return (
    <div
      className="q-file-tree"
      onContextMenu={(event) => {
        if (!root) return;
        if (event.target instanceof Element && event.target.closest('[data-file-id]')) return;
        rootMenu.onContextMenu(event);
      }}
    >
      {error && <p className="q-file-tree__error" role="alert">{error}</p>}
      {rows.length === 0 ? (
        <EmptyState icon={FileText} title={t('fileTree.empty')} compact>
          <Button size="s" disabled={!root} onClick={() => root && actions.createNoteIn?.(root)}>
            {t('fileTree.newNote')}
          </Button>
          <Button
            size="s"
            variant="ghost"
            disabled={!root}
            onClick={() => root && actions.createFolderIn?.(root)}
          >
            {t('fileTree.newFolder')}
          </Button>
        </EmptyState>
      ) : rows.map((row) => {
        const selected = selectedFiles.has(row.item.id);
        return (
          <FileTreeRow
            key={row.item.id}
            item={row.item}
            depth={row.depth}
            expanded={row.expanded}
            loading={row.loading}
            active={row.comparableId === activePath}
            selected={selected}
            guideDepths={row.guideDepths}
            renaming={renamingPath === row.item.id}
            actions={actions}
            icon={icons?.[row.item.id]}
            onIconChange={onIconChange}
          />
        );
      })}
      {root && rootMenu.open && (
        <Menu
          open
          position={rootMenu.position}
          items={rootActionItems(actions, root)}
          onClose={rootMenu.close}
          ariaLabel={t('fileTree.rootActions')}
        />
      )}
    </div>
  );
});
