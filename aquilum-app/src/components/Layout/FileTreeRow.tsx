import { memo, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle, Palette } from 'lucide';
import { IconizePicker } from './IconizePicker';
import { fileIcon, type FileIconAssignment } from './iconize';
import { Icon } from '../Common/Icon';
import { isBasePath, isCanvasPath, isMarkdownPath, type WorkspaceItem } from '../../modules/documents/fileGateway';
import { fileActionItems } from './fileActionItems';
import { parseGuideDepths, type FileTreeActions } from './fileTreeModel';
import { FileTreeRename } from './FileTreeRename';
import { Menu } from '../Common/Menu';
import { t } from '../../i18n';
import { titleWhenClipped } from '../Common/titleWhenClipped';
import { useContextMenu } from '../Common/useContextMenu';

interface FileTreeRowProps {
  item: WorkspaceItem;
  depth: number;
  expanded: boolean;
  loading: boolean;
  active: boolean;
  selected: boolean;
  guideDepths: string;
  renaming: boolean;
  actions: FileTreeActions;
  icon?: FileIconAssignment;
  onIconChange?: (path: string, icon: FileIconAssignment | null) => void;
}

export const FileTreeRow = memo(function FileTreeRow({
  item,
  depth,
  expanded,
  loading,
  active,
  selected,
  guideDepths,
  renaming,
  actions,
  icon,
  onIconChange,
}: FileTreeRowProps) {
  const isFolder = item.type === 'folder';
  const canRowActions = isFolder || isMarkdownPath(item.id) || isBasePath(item.id) || isCanvasPath(item.id);
  const menu = useContextMenu();
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);

  const itemClass = [
    'q-file-item',
    active ? 'active' : '',
    selected ? 'selected' : '',
    renaming ? 'renaming' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      ref={rowRef}
      className="q-file-tree-node"
      data-file-id={item.id}
      data-file-type={item.type}
      data-file-name={item.name}
      data-renaming={renaming ? '' : undefined}
      style={{ '--q-file-depth': depth } as CSSProperties}
    >
      {parseGuideDepths(guideDepths).map((guideDepth) => (
        <div
          key={guideDepth}
          className="q-file-tree-guide"
          style={{ '--q-guide-depth': guideDepth } as CSSProperties}
        />
      ))}
      {renaming ? (
        <FileTreeRename
          name={item.name}
          className={itemClass}
          active={active}
          onCommit={(nextName) => actions.commitRename(item.id, nextName)}
          onCancel={actions.cancelRename}
        />
      ) : (
        <button
          type="button"
          className={itemClass}
          data-file-active={active || undefined}
          aria-expanded={isFolder ? expanded : undefined}
          onMouseEnter={() => {
            if (isFolder) actions.prefetchFolder(item.id);
          }}
          onClick={(event) => {
            const primary = event.ctrlKey || event.metaKey;
            if (primary && event.shiftKey) {
              actions.openInNewTab(item.id);
            } else if (isFolder && !primary && !event.shiftKey) {
              actions.toggleFolder(item.id);
            } else {
              actions.selectFile(item.id, primary, event.shiftKey);
            }
          }}
          onContextMenu={(event) => {
            if (!canRowActions) return;
            actions.focusRow(item.id);
            menu.onContextMenu(event);
          }}
        >
          <span className="q-file-icon" aria-hidden="true">
            {isFolder && (loading
              ? <Icon icon={LoaderCircle} className="q-file-icon__spinner" />
              : expanded ? <Icon icon={ChevronDown} /> : <Icon icon={ChevronRight} />)}
          </span>
          {onIconChange && icon && <span className="q-file-icon-custom"
            style={{ color: icon.color }} aria-hidden="true"><Icon icon={fileIcon(icon.name)} /></span>}
          <span
            className="q-file-name"
            onMouseEnter={(event) => titleWhenClipped(event.currentTarget, item.name)}
          >
            {item.name}
          </span>
        </button>
      )}
      {canRowActions && menu.open && (
        <Menu
          open
          position={menu.position}
          items={onIconChange ? [
            ...fileActionItems(actions, item.id),
            { id: 'iconize', label: t('fileTree.iconize'), icon: Palette,
              onSelect: () => setIconPickerOpen(true) },
          ] : fileActionItems(actions, item.id)}
          onClose={menu.close}
          ariaLabel={isFolder ? t('fileTree.folderActions') : t('fileTree.fileActions')}
        />
      )}
      {onIconChange && iconPickerOpen && rowRef.current && <IconizePicker anchor={rowRef.current} value={icon}
        onChange={(next) => onIconChange(item.id, next)}
        onClose={() => setIconPickerOpen(false)} />}
    </div>
  );
});
