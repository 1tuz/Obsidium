import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Button } from '../Common/Button';
import { Dialog, DialogFooter } from '../Common/Dialog';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { Menu, type MenuItem, type MenuPosition } from '../Common/Menu';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { Columns3, Folder, MoreHorizontal, Pencil, Trash2 } from 'lucide';
import { listen } from '@tauri-apps/api/event';
import { t } from '../../i18n';
import {
  addToBoard,
  boardMembership,
  buildKanbanBase,
  parseBase,
  removeFromBoard,
  scanKanbanBoards,
  type KanbanBoard,
  type KanbanBoardCache,
  type KanbanBoardSource,
} from '../../modules/bases';
import {
  createAtFreeName,
  createFile,
  isBasePath,
  readDirectory,
  readFileSnapshot,
  trashFile,
  writeFileAtomic,
  type FileSnapshot,
} from '../../modules/documents/fileGateway';
import { renameWorkspaceFile } from '../../modules/documents/renameWorkspaceFile';
import { childPath } from '../../modules/paths';
import { boardTree, type BoardFolder } from '../../modules/bases/boardTree';
import './BoardsPanel.css';

export interface BoardActionRequest {
  path: string;
  action: 'add' | 'remove';
  id: number;
}

interface BoardsPanelProps {
  active: boolean;
  workspacePath: string | null;
  onOpenView: (path: string, viewIndex: number) => void;
  actionRequest: BoardActionRequest | null;
  onActionRequestComplete: () => void;
  createRequest: number;
}

const STATUS_COLUMNS = ['backlog', 'todo', 'doing', 'done'];

function FolderTree({
  folder,
  onOpenView,
  onRenameBoard,
  onDeleteBoard,
}: {
  folder: BoardFolder;
  onOpenView: BoardsPanelProps['onOpenView'];
  onRenameBoard: (board: KanbanBoard) => void;
  onDeleteBoard: (board: KanbanBoard) => void;
}) {
  return (
    <ul className="q-boards-tree">
      {folder.folders.map((child) => (
        <li key={child.path}>
          <details open>
            <summary><Icon icon={Folder} />{child.name}</summary>
            <FolderTree
              folder={child}
              onOpenView={onOpenView}
              onRenameBoard={onRenameBoard}
              onDeleteBoard={onDeleteBoard}
            />
          </details>
        </li>
      ))}
      {folder.boards.map((board) => (
        <li className="q-boards-tree__board" key={board.path}>
          <div className="q-boards-tree__heading">
            <strong>{board.name}</strong>
            <BoardMenu board={board} onRename={onRenameBoard} onDelete={onDeleteBoard} />
          </div>
          {board.views.map((view) => (
            <button
              type="button"
              key={`${board.path}:${view.index}`}
              title={board.path}
              onClick={() => onOpenView(board.path, view.index)}
            >
              <Icon icon={Columns3} />
              <span>{view.name}</span>
            </button>
          ))}
        </li>
      ))}
    </ul>
  );
}

function BoardMenu({
  board,
  onRename,
  onDelete,
}: {
  board: KanbanBoard;
  onRename: (board: KanbanBoard) => void;
  onDelete: (board: KanbanBoard) => void;
}) {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const close = useCallback(() => setPosition(null), []);
  const items: MenuItem[] = [
    { id: 'rename', label: t('common.rename'), icon: Pencil, onSelect: () => onRename(board) },
    { id: 'delete', label: t('common.delete'), icon: Trash2, onSelect: () => onDelete(board) },
  ];

  return (
    <>
      <IconButton
        label={t('boards.actions', { name: board.name })}
        size="small"
        aria-expanded={Boolean(position)}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPosition({ top: rect.bottom, left: rect.right });
        }}
      >
        <Icon icon={MoreHorizontal} />
      </IconButton>
      <Menu open={Boolean(position)} position={position} items={items} onClose={close} />
    </>
  );
}

export function BoardsPanel({
  active,
  workspacePath,
  onOpenView,
  actionRequest,
  onActionRequestComplete,
  createRequest,
}: BoardsPanelProps) {
  const cache = useRef<KanbanBoardCache>(new Map());
  const scanQueue = useRef(Promise.resolve());
  const scanRevision = useRef(0);
  const lastCreateRequest = useRef(0);
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [renameTarget, setRenameTarget] = useState<KanbanBoard | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<KanbanBoard | null>(null);
  const [renameError, setRenameError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [boardActionPending, setBoardActionPending] = useState(false);
  const tree = useMemo(
    () => workspacePath ? boardTree(boards, workspacePath) : null,
    [boards, workspacePath],
  );

  const refresh = useCallback(() => {
    if (!workspacePath) return Promise.resolve();
    const revision = ++scanRevision.current;
    const scan = scanQueue.current.catch(() => undefined).then(async () => {
      if (revision !== scanRevision.current) return;
      setLoading(true);
      setFailed(false);
      try {
        const next = await scanKanbanBoards(workspacePath, readDirectory, readFileSnapshot, cache.current);
        if (revision === scanRevision.current) setBoards(next);
      } catch (error) {
        console.error('Failed to scan Kanban Bases', error);
        if (revision === scanRevision.current) setFailed(true);
      } finally {
        if (revision === scanRevision.current) setLoading(false);
      }
    });
    scanQueue.current = scan.catch(() => undefined);
    return scan;
  }, [workspacePath]);

  useEffect(() => {
    if (actionRequest) void refresh();
  }, [actionRequest?.id, refresh]);

  useEffect(() => {
    if (!active) return undefined;
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    let timer: number | null = null;
    void listen<string[]>('workspace-changed', ({ payload }) => {
      if (!payload.some(isBasePath)) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void refresh();
      }, 80);
    }).then((dispose) => {
      if (disposed) dispose();
      else {
        unsubscribe = dispose;
        void refresh();
      }
    }).catch((error) => {
      if (!disposed) console.error('Failed to watch Kanban Base changes', error);
    });
    return () => {
      disposed = true;
      unsubscribe?.();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [active, refresh]);

  useEffect(() => {
    if (createRequest <= lastCreateRequest.current) return;
    lastCreateRequest.current = createRequest;
    setNewOpen(true);
  }, [createRequest]);

  const completeAction = () => {
    setActionError('');
    onActionRequestComplete();
  };

  const saveBoardName = async (name: string) => {
    if (!renameTarget || boardActionPending) return;
    setBoardActionPending(true);
    setRenameError('');
    try {
      const nextPath = await renameWorkspaceFile(renameTarget.path, name);
      if (!nextPath && name.trim() !== renameTarget.name) throw new Error(t('boards.invalidName'));
      setRenameTarget(null);
      await refresh();
    } catch (error) {
      setRenameError(t('boards.renameError', { reason: String(error) }));
    } finally {
      setBoardActionPending(false);
    }
  };

  const confirmBoardDelete = async () => {
    if (!deleteTarget || !workspacePath || boardActionPending) return;
    setBoardActionPending(true);
    setDeleteError('');
    try {
      await trashFile(workspacePath, deleteTarget.path);
      setDeleteTarget(null);
      await refresh();
    } catch (error) {
      setDeleteError(t('boards.deleteError', { reason: String(error) }));
    } finally {
      setBoardActionPending(false);
    }
  };

  const applyBoardAction = async (board: KanbanBoard, viewIndex: number) => {
    if (!actionRequest) return;
    const view = board.views.find((candidate) => candidate.index === viewIndex);
    if (!view) return;
    if (view.membership.kind === 'unsupported') {
      setActionError(view.membership.reason);
      return;
    }
    try {
      const snapshot: FileSnapshot = await readFileSnapshot(actionRequest.path);
      const membership = boardMembership(parseBase((await readFileSnapshot(board.path)).content), viewIndex);
      if (membership.kind === 'unsupported') {
        setActionError(membership.reason);
        return;
      }
      const next = actionRequest.action === 'add'
        ? addToBoard(snapshot.content, membership, membership.initialGroup)
        : removeFromBoard(snapshot.content, membership);
      if (next === snapshot.content) {
        setActionError(actionRequest.action === 'add'
          ? t('boards.unchangedAdd')
          : t('boards.unchangedRemove'));
        return;
      }
      await writeFileAtomic(actionRequest.path, next, snapshot.hash);
      completeAction();
    } catch (error) {
      setActionError(t('boards.writeError', { reason: String(error) }));
    }
  };

  return (
    <section className="q-boards-panel" aria-label={t('boards.title')}>
      <header className="q-boards-panel__header">
        <h2>{t('boards.title')}</h2>
        <Button size="s" onClick={() => setNewOpen(true)}>{t('boards.newBoard')}</Button>
      </header>
      {loading && boards.length === 0 ? <p>{t('boards.loading')}</p> : null}
      {failed ? <p role="alert">{t('boards.loadError')}</p> : null}
      {!loading && !failed && boards.length === 0 ? <p>{t('boards.empty')}</p> : null}
      {tree && boards.length > 0 ? (
        <FolderTree
          folder={tree}
          onOpenView={onOpenView}
          onRenameBoard={(board) => { setRenameError(''); setRenameTarget(board); }}
          onDeleteBoard={(board) => { setDeleteError(''); setDeleteTarget(board); }}
        />
      ) : null}
      <NewBoardDialog
        open={newOpen}
        workspacePath={workspacePath}
        onClose={() => setNewOpen(false)}
        onCreated={() => { void refresh(); }}
      />
      <BoardActionDialog
        request={actionRequest}
        boards={boards}
        error={actionError}
        onSelect={applyBoardAction}
        onClose={completeAction}
      />
      <RenameBoardDialog
        board={renameTarget}
        error={renameError}
        pending={boardActionPending}
        onSave={saveBoardName}
        onClose={() => setRenameTarget(null)}
      />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('boards.deleteTitle')}
        description={t('boards.deleteDescription', { name: deleteTarget?.name ?? '' })}
        error={deleteError}
        confirmLabel={t('common.delete')}
        pending={boardActionPending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmBoardDelete()}
      />
    </section>
  );
}

function RenameBoardDialog({
  board,
  error,
  pending,
  onSave,
  onClose,
}: {
  board: KanbanBoard | null;
  error: string;
  pending: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');

  useEffect(() => setName(board?.name ?? ''), [board]);

  return (
    <Dialog
      open={Boolean(board)}
      title={t('boards.renameTitle')}
      closeLabel={t('common.cancel')}
      dismissible={!pending}
      onClose={onClose}
      className="q-boards-dialog"
    >
      <div className="q-boards-form">
        <label className="q-boards-form__field">
          <span>{t('boards.name')}</span>
          <input autoFocus value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.currentTarget.value)} />
        </label>
        {error ? <p className="q-boards-form__error" role="alert">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={pending} onClick={onClose}>{t('common.cancel')}</Button>
        <Button disabled={pending || !name.trim()} onClick={() => onSave(name)}>
          {pending ? t('boards.renaming') : t('common.rename')}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function NewBoardDialog({
  open,
  workspacePath,
  onClose,
  onCreated,
}: {
  open: boolean;
  workspacePath: string | null;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [sourceKind, setSourceKind] = useState<KanbanBoardSource['kind']>('wholeVault');
  const [folder, setFolder] = useState('');
  const [tag, setTag] = useState('');
  const [property, setProperty] = useState('project');
  const [propertyValue, setPropertyValue] = useState('');
  const [custom, setCustom] = useState('');
  const [groupBy, setGroupBy] = useState('status');
  const [columns, setColumns] = useState(STATUS_COLUMNS.join(', '));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!workspacePath || saving) return;
    const fileName = name.trim().replace(/\.base$/i, '');
    if (!fileName || /[\\/]/u.test(fileName)) {
      setError(t('boards.invalidName'));
      return;
    }
    const source: KanbanBoardSource = sourceKind === 'folder'
      ? { kind: 'folder', folder }
      : sourceKind === 'tag'
        ? { kind: 'tag', tag }
        : sourceKind === 'property'
          ? { kind: 'property', property, value: propertyValue }
          : sourceKind === 'custom'
            ? { kind: 'custom', filter: custom }
            : { kind: 'wholeVault' };
    let content: string;
    try {
      content = buildKanbanBase({
        name: fileName,
        source,
        groupBy,
        columns: columns.split(',').map((column) => column.trim()),
      });
    } catch (cause) {
      setError(String(cause));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const path = childPath(workspacePath, `${fileName}.base`);
      const created = await createAtFreeName(
        (attempt) => attempt === 0 ? path : childPath(workspacePath, `${fileName} (${attempt}).base`),
        (candidate) => createFile(candidate, content),
      );
      if (!created) throw new Error(t('boards.nameExhausted'));
      onCreated();
      onClose();
      setName('');
    } catch (cause) {
      setError(t('boards.createError', { reason: String(cause) }));
    } finally {
      setSaving(false);
    }
  };

  const label = (text: string, input: ReactNode) => (
    <label className="q-boards-form__field"><span>{text}</span>{input}</label>
  );

  return (
    <Dialog open={open} title={t('boards.newBoard')} closeLabel={t('boards.cancel')} onClose={onClose} className="q-boards-dialog">
      <div className="q-boards-form">
        {label(t('boards.name'), <input autoFocus value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.currentTarget.value)} />)}
        {label(t('boards.source'), <select value={sourceKind} onChange={(event: ChangeEvent<HTMLSelectElement>) => setSourceKind(event.currentTarget.value as KanbanBoardSource['kind'])}>
          <option value="folder">{t('boards.folder')}</option>
          <option value="tag">{t('boards.tag')}</option>
          <option value="property">{t('boards.property')}</option>
          <option value="wholeVault">{t('boards.wholeVault')}</option>
          <option value="custom">{t('boards.customFilter')}</option>
        </select>)}
        {sourceKind === 'folder' && label(t('boards.folder'), <input value={folder} onChange={(event: ChangeEvent<HTMLInputElement>) => setFolder(event.currentTarget.value)} />)}
        {sourceKind === 'tag' && label(t('boards.tag'), <input value={tag} onChange={(event: ChangeEvent<HTMLInputElement>) => setTag(event.currentTarget.value)} />)}
        {sourceKind === 'property' && <>
          {label(t('boards.property'), <input value={property} onChange={(event: ChangeEvent<HTMLInputElement>) => setProperty(event.currentTarget.value)} />)}
          {label(t('boards.propertyValue'), <input value={propertyValue} onChange={(event: ChangeEvent<HTMLInputElement>) => setPropertyValue(event.currentTarget.value)} />)}
        </>}
        {sourceKind === 'custom' && label(t('boards.customFilter'), <textarea value={custom} onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setCustom(event.currentTarget.value)} />)}
        {label(t('boards.groupBy'), <input value={groupBy} onChange={(event: ChangeEvent<HTMLInputElement>) => setGroupBy(event.currentTarget.value)} />)}
        {label(t('boards.columns'), <input value={columns} onChange={(event: ChangeEvent<HTMLInputElement>) => setColumns(event.currentTarget.value)} />)}
        {error ? <p className="q-boards-form__error" role="alert">{error}</p> : null}
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>{t('boards.cancel')}</Button>
        <Button disabled={saving} onClick={() => void create()}>{saving ? t('boards.creating') : t('boards.create')}</Button>
      </DialogFooter>
    </Dialog>
  );
}

function BoardActionDialog({
  request,
  boards,
  error,
  onSelect,
  onClose,
}: {
  request: BoardActionRequest | null;
  boards: KanbanBoard[];
  error: string;
  onSelect: (board: KanbanBoard, index: number) => void;
  onClose: () => void;
}) {
  const title = request?.action === 'remove' ? t('boards.selectRemove') : t('boards.selectAdd');
  return (
    <Dialog open={Boolean(request)} title={title} closeLabel={t('boards.cancel')} onClose={onClose} className="q-boards-dialog">
      <div className="q-boards-actions">
        {boards.flatMap((board) => board.views.map((view) => (
          <div className="q-boards-actions__item" key={`${board.path}:${view.index}`}>
            <Button
              variant="ghost"
              disabled={view.membership.kind === 'unsupported'}
              onClick={() => void onSelect(board, view.index)}
            >
              {board.name} — {view.name}
            </Button>
            {view.membership.kind === 'unsupported' ? (
              <small>{t('boards.cannotAuto', { reason: view.membership.reason })}</small>
            ) : null}
          </div>
        )))}
        {boards.length === 0 ? <p>{t('boards.empty')}</p> : null}
        {error ? <p className="q-boards-form__error" role="alert">{error}</p> : null}
      </div>
      <DialogFooter><Button variant="ghost" onClick={onClose}>{t('boards.cancel')}</Button></DialogFooter>
    </Dialog>
  );
}
