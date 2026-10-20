import { t } from '../../i18n';
import { useCallback, useEffect, useState } from 'react';
import { Check, File, FolderOpen, Library, MoreHorizontal, Settings2, X } from 'lucide';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { Icon } from '../Common/Icon';
import { Button } from '../Common/Button';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { Dialog, DialogFooter } from '../Common/Dialog';
import { EmptyState } from '../Common/EmptyState';
import { IconButton } from '../Common/IconButton';
import { Menu } from '../Common/Menu';
import { ScrollArea } from '../Common/ScrollArea';
import { useContextMenu } from '../Common/useContextMenu';
import {
  forgetWorkspace,
  listWorkspaces,
  pickWorkspaceFolder,
  type KnownWorkspace,
} from '../../modules/workspaces';
import { fileName, samePath } from '../../modules/paths';
import { copyText } from '../../modules/clipboard';
import './WorkspaceDialog.css';

interface WorkspaceDialogProps {
  open: boolean;
  currentPath: string | null;
  onClose: () => void;
  onOpenWorkspace: (path: string) => Promise<boolean>;
}

export function WorkspaceDialog({ open, currentPath, onClose, onOpenWorkspace }: WorkspaceDialogProps) {
  const [workspaces, setWorkspaces] = useState<KnownWorkspace[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forgetTarget, setForgetTarget] = useState<KnownWorkspace | null>(null);
  const [managing, setManaging] = useState(false);

  const reload = useCallback(async () => {
    try {
      setWorkspaces(await listWorkspaces());
      setError(null);
    } catch (reason) {
      console.error('Failed to list workspaces', reason);
      setWorkspaces([]);
      setError(t('workspaces.listFailed', { reason: String(reason) }));
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setError(null);
      setForgetTarget(null);
      setWorkspaces(null);
      setManaging(false);
      return;
    }
    void reload();
  }, [open, reload]);

  const switchTo = useCallback(async (path: string) => {
    setPending(true);
    setError(null);
    try {
      if (await onOpenWorkspace(path)) onClose();
      else setError(t('workspaces.openFailed', { path }));
    } catch (reason) {
      console.error('Failed to open a workspace', reason);
      setError(t('workspaces.openFailed', { path }));
    } finally {
      setPending(false);
    }
  }, [onClose, onOpenWorkspace]);

  const pickFolder = useCallback(async () => {
    try {
      const path = await pickWorkspaceFolder();
      if (path) await switchTo(path);
    } catch (reason) {
      console.error('Failed to pick a workspace folder', reason);
    }
  }, [switchTo]);

  const confirmForget = useCallback(async () => {
    if (!forgetTarget) return;
    setPending(true);
    try {
      await forgetWorkspace(forgetTarget.id);
      await reload();
    } catch (reason) {
      console.error('Failed to forget a workspace', reason);
      setError(t('workspaces.forgetFailed'));
    } finally {
      setPending(false);
      setForgetTarget(null);
    }
  }, [forgetTarget, reload]);

  return (
    <>
      <Dialog
        open={open}
        title={t(managing ? 'workspaces.manageTitle' : 'workspaces.title')}
        closeLabel={t('workspaces.close')}
        className="q-workspace-dialog"
        onClose={onClose}
      >
        <ScrollArea className="q-workspace-dialog__list">
          {workspaces?.length === 0 ? (
            <EmptyState
              icon={Library}
              title={t('workspaces.empty')}
              description={t('workspaces.emptyHint')}
              compact
            />
          ) : workspaces?.map((workspace) => {
            const isCurrent = samePath(workspace.path, currentPath);
            return (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                current={isCurrent}
                pending={pending}
                managing={managing}
                onOpen={() => { void switchTo(workspace.path); }}
                onForget={() => setForgetTarget(workspace)}
                onError={setError}
              />
            );
          })}
        </ScrollArea>

        {error ? <p className="q-workspace-dialog__error" role="alert">{error}</p> : null}

        <DialogFooter>
          {managing ? (
            <Button variant="ghost" disabled={pending} onClick={() => setManaging(false)}>
              {t('workspaces.back')}
            </Button>
          ) : (
            <Button variant="ghost" disabled={pending} onClick={() => setManaging(true)}>
              <Icon icon={Settings2} />
              {t('workspaces.manage')}
            </Button>
          )}
          <Button disabled={pending} onClick={() => { void pickFolder(); }}>
            <Icon icon={FolderOpen} />
            {t('common.openFolder')}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={forgetTarget !== null}
        title={t('workspaces.forgetTitle')}
        description={t('workspaces.forgetDescription', { name: forgetTarget ? fileName(forgetTarget.path) : '' })}
        confirmLabel={t('workspaces.forgetConfirm')}
        pendingLabel={t('workspaces.forgetPending')}
        pending={pending}
        onCancel={() => setForgetTarget(null)}
        onConfirm={() => { void confirmForget(); }}
      />
    </>
  );
}

interface WorkspaceRowProps {
  workspace: KnownWorkspace;
  current: boolean;
  pending: boolean;
  managing: boolean;
  onOpen: () => void;
  onForget: () => void;
  onError: (message: string) => void;
}

function WorkspaceRow({ workspace, current, pending, managing, onOpen, onForget, onError }: WorkspaceRowProps) {
  const menu = useContextMenu();
  const menuItems = [
    {
      id: 'copy-id',
      label: t('workspaces.copyId'),
      icon: File,
      onSelect: () => {
        void copyText(workspace.id).then((ok) => {
          if (ok) return;
          console.error('Failed to copy workspace ID');
          onError(t('workspaces.copyFailed'));
        });
      },
    },
    {
      id: 'reveal',
      label: t('workspaces.reveal'),
      icon: FolderOpen,
      onSelect: () => {
        void revealItemInDir(workspace.path).catch((reason) => {
          console.error('Failed to reveal workspace folder', reason);
          onError(t('workspaces.revealFailed'));
        });
      },
    },
    ...(!current ? [{
      id: 'forget',
      label: t('workspaces.forgetFromList'),
      icon: X,
      onSelect: onForget,
    }] : []),
  ];

  return (
    <div
      className={`q-workspace-row${current ? ' q-workspace-row--current' : ''}`}
      onContextMenu={managing ? menu.onContextMenu : undefined}
    >
      <button
        type="button"
        className="q-workspace-row__main"
        disabled={pending || current}
        title={workspace.path}
        onClick={onOpen}
      >
        <span className="q-workspace-row__icon" aria-hidden="true">
          {current ? <Icon icon={Check} /> : null}
        </span>
        <span className="q-workspace-row__text">
          <span className="q-workspace-row__name">{fileName(workspace.path)}</span>
          <span className="q-workspace-row__path">{workspace.path}</span>
        </span>
      </button>
      {managing ? (
        <IconButton
          size="small"
          className="q-workspace-row__menu"
          label={t('workspaces.actionsFor', { name: fileName(workspace.path) })}
          disabled={pending}
          onClick={(event) => menu.onContextMenu(event)}
        >
          <Icon icon={MoreHorizontal} />
        </IconButton>
      ) : current ? null : (
        <IconButton
          size="small"
          className="q-workspace-row__forget"
          label={t('workspaces.forget', { name: fileName(workspace.path) })}
          disabled={pending}
          onClick={onForget}
        >
          <Icon icon={X} />
        </IconButton>
      )}
      {managing ? (
        <Menu
          open={menu.open}
          position={menu.position}
          items={menuItems}
          onClose={menu.close}
          ariaLabel={t('workspaces.actions')}
        />
      ) : null}
    </div>
  );
}
