import { FolderOpen } from 'lucide-react';
import { Button } from '../Common/Button';
import { EmptyState } from '../Common/EmptyState';
import { pickWorkspaceFolder } from '../../modules/workspaces';
import { t } from '../../i18n';

interface WorkspaceEmptyStateProps {
  onOpen: (path: string) => Promise<boolean>;
  failedPath: string | null;
}

export function WorkspaceEmptyState({ onOpen, failedPath }: WorkspaceEmptyStateProps) {
  const handleOpenFolder = async () => {
    const path = await pickWorkspaceFolder();
    if (path) await onOpen(path);
  };

  return (
    <EmptyState
      icon={FolderOpen}
      title={t('fileTree.noFolder')}
      description={failedPath ? t('workspaces.openFailed', { path: failedPath }) : undefined}
    >
      <Button size="s" onClick={() => void handleOpenFolder()}>
        <FolderOpen aria-hidden="true" />
        {t('common.openFolder')}
      </Button>
    </EmptyState>
  );
}
