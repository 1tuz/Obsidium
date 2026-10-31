import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Pencil, Trash2 } from 'lucide';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { Icon } from '../Common/Icon';
import { Menu, type MenuItem, type MenuPosition } from '../Common/Menu';
import { FileTreeRename } from './FileTreeRename';
import { t } from '../../i18n';
import { scanCanvases, type VaultCanvas } from '../../modules/canvas/scanCanvases';
import { isCanvasPath, readDirectory, trashFile } from '../../modules/documents/fileGateway';
import { renameWorkspaceFile } from '../../modules/documents/renameWorkspaceFile';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { WORKSPACE_CHANGED_EVENT } from '../../hooks/useWorkspaceEvents';
import { SidebarPanelHeader } from './SidebarPanelHeader';
import './CanvasPanel.css';

interface CanvasPanelProps {
  active: boolean;
  workspacePath: string | null;
  onOpenCanvas: (path: string) => void;
  onCreateCanvas: () => void;
}

interface CanvasFolder {
  name: string;
  canvases: VaultCanvas[];
  folders: CanvasFolder[];
}

function canvasFolders(canvases: readonly VaultCanvas[]): CanvasFolder {
  const root: CanvasFolder = { name: '', canvases: [], folders: [] };
  for (const canvas of canvases) {
    const parts = canvas.folder ? canvas.folder.split('/') : [];
    let current = root;
    for (const name of parts) {
      let folder = current.folders.find((candidate) => candidate.name === name);
      if (!folder) {
        folder = { name, canvases: [], folders: [] };
        current.folders.push(folder);
      }
      current = folder;
    }
    current.canvases.push(canvas);
  }
  return root;
}

function CanvasTree({
  folder,
  onOpenCanvas,
  onContextMenu,
  renamingPath,
  onCommitRename,
  onCancelRename,
}: {
  folder: CanvasFolder;
  onOpenCanvas: (path: string) => void;
  onContextMenu: (path: string, left: number, top: number) => void;
  renamingPath: string | null;
  onCommitRename: (path: string, name: string) => void;
  onCancelRename: () => void;
}) {
  return (
    <ul className="q-canvas-panel__tree">
      {folder.folders.map((child) => (
        <li key={child.name}>
          <details open>
            <summary><Icon icon="folder" />{child.name}</summary>
            <CanvasTree
              folder={child}
              onOpenCanvas={onOpenCanvas}
              onContextMenu={onContextMenu}
              renamingPath={renamingPath}
              onCommitRename={onCommitRename}
              onCancelRename={onCancelRename}
            />
          </details>
        </li>
      ))}
      {folder.canvases.map((canvas) => (
        <li key={canvas.path}>
          {renamingPath === canvas.path ? (
            <FileTreeRename
              name={canvas.name}
              className="q-canvas-panel__item"
              active
              onCommit={(name) => onCommitRename(canvas.path, name)}
              onCancel={onCancelRename}
            />
          ) : (
            <button
              type="button"
              className="q-canvas-panel__item"
              title={canvas.path}
              onClick={() => onOpenCanvas(canvas.path)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onContextMenu(canvas.path, event.clientX, event.clientY);
              }}
            >
              <Icon icon="canvas" />
              <span>{canvas.name}</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function CanvasPanel({ active, workspacePath, onOpenCanvas, onCreateCanvas }: CanvasPanelProps) {
  const revision = useRef(0);
  const scopeRevision = useRef(0);
  const previousScope = useRef({ active, workspacePath });
  const deletePending = useRef(false);
  const [canvases, setCanvases] = useState<VaultCanvas[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<{ path: string; position: MenuPosition } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VaultCanvas | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState('');
  const tree = useMemo(() => canvasFolders(canvases), [canvases]);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setCanvases([]);
      return;
    }
    const current = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const next = await scanCanvases(
        workspacePath,
        readDirectory,
        () => current !== revision.current,
      );
      if (current === revision.current) setCanvases(next);
    } catch (cause) {
      console.error('Failed to scan canvases', cause);
      if (current === revision.current) setError(String(cause));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  useEffect(() => () => {
    revision.current += 1;
  }, []);

  useLayoutEffect(() => {
    if (previousScope.current.active === active && previousScope.current.workspacePath === workspacePath) return;
    previousScope.current = { active, workspacePath };
    scopeRevision.current += 1;
    revision.current += 1;
    setMenu(null);
    setRenamingPath(null);
    setDeleteTarget(null);
    setActionError('');
  }, [active, workspacePath]);

  useTauriEvent<string[]>(WORKSPACE_CHANGED_EVENT, (paths) => {
    if (!paths.some(isCanvasPath)) return;
    void refresh();
  }, active);

  const canvas = menu ? canvases.find((item) => item.path === menu.path) : undefined;
  const items: MenuItem[] = canvas ? [
    { id: 'open', label: t('fileTree.open'), icon: ExternalLink, onSelect: () => onOpenCanvas(canvas.path) },
    { id: 'rename', label: t('common.rename'), icon: Pencil, onSelect: () => setRenamingPath(canvas.path) },
    { id: 'delete', label: t('common.delete'), icon: Trash2, danger: true, onSelect: () => { setActionError(''); setDeleteTarget(canvas); } },
  ] : [];

  const commitRename = async (path: string, name: string) => {
    setRenamingPath(null);
    if (!name.trim()) return;
    const currentRevision = scopeRevision.current;
    try {
      const renamed = await renameWorkspaceFile(path, name);
      if (currentRevision !== scopeRevision.current) return;
      if (renamed) await refresh();
    } catch (cause) {
      if (currentRevision === scopeRevision.current) setActionError(t('fileTree.renameFailed', { name }));
      console.error('Failed to rename canvas', cause);
    }
  };

  const confirmDelete = async () => {
    if (!workspacePath || !deleteTarget || deletePending.current) return;
    const currentRevision = scopeRevision.current;
    const currentWorkspace = workspacePath;
    deletePending.current = true;
    setIsDeleting(true);
    try {
      await trashFile(currentWorkspace, deleteTarget.path);
      if (currentRevision !== scopeRevision.current) return;
      setDeleteTarget(null);
      await refresh();
    } catch (cause) {
      if (currentRevision === scopeRevision.current) {
        setActionError(t('fileTree.deleteFailed', { reason: deleteTarget.path }));
      }
      console.error('Failed to delete canvas', cause);
    } finally {
      deletePending.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <section className="q-canvas-panel" aria-label={t('canvasPanel.title')}>
      <SidebarPanelHeader
        title={t('canvasPanel.title')}
        createLabel={t('canvasPanel.create')}
        disabled={!workspacePath}
        onCreate={onCreateCanvas}
      />
      {loading && canvases.length === 0 ? <p>{t('canvasPanel.loading')}</p> : null}
      {error ? <p role="alert">{t('error.recoveryFailed', { reason: error })}</p> : null}
      {actionError ? <p role="alert">{actionError}</p> : null}
      {!loading && !error && canvases.length === 0 ? <p>{t('canvasPanel.empty')}</p> : null}
      {canvases.length > 0 ? (
        <CanvasTree
          folder={tree}
          onOpenCanvas={onOpenCanvas}
          onContextMenu={(path, left, top) => setMenu({ path, position: { left, top } })}
          renamingPath={renamingPath}
          onCommitRename={(path, name) => { void commitRename(path, name); }}
          onCancelRename={() => setRenamingPath(null)}
        />
      ) : null}
      <Menu open={Boolean(menu)} position={menu?.position ?? null} items={items} onClose={() => setMenu(null)} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('common.delete')}
        description={deleteTarget?.path ?? ''}
        error={actionError || undefined}
        confirmLabel={t('common.delete')}
        pending={isDeleting}
        onCancel={() => { setDeleteTarget(null); setActionError(''); }}
        onConfirm={() => { void confirmDelete(); }}
      />
    </section>
  );
}
