import { memo } from 'react';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { t } from '../../i18n';
import './SidebarHeaderActions.css';

interface SidebarHeaderActionsProps {
  onCreateNote: () => void;
  onCreateFolder: () => void;
  onSearch?: () => void;
  disabled?: boolean;
}

export const SidebarHeaderActions = memo(function SidebarHeaderActions({
  onCreateNote,
  onCreateFolder,
  onSearch,
  disabled,
}: SidebarHeaderActionsProps) {
  const buttons: Array<{ id: 'search' | 'file-plus' | 'folder-plus'; label: string; onClick: () => void }> = [
    { id: 'file-plus', label: t('fileTree.newNote'), onClick: onCreateNote },
    { id: 'folder-plus', label: t('fileTree.newFolder'), onClick: onCreateFolder },
    ...(onSearch ? [{ id: 'search' as const, label: t('fileTree.searchVault'), onClick: onSearch }] : []),
  ];

  return (
    <div className="q-sidebar-header-actions">
      {buttons.map((button) => (
        <IconButton
          key={button.id}
          id={button.id}
          size="small"
          label={button.label}
          disabled={disabled}
          onClick={button.onClick}
        >
          <Icon icon={button.id} />
        </IconButton>
      ))}
    </div>
  );
});
