import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, MoreHorizontal, Pencil, Trash2 } from 'lucide';
import { Button } from '../Common/Button';
import { ConfirmDialog } from '../Common/ConfirmDialog';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { Menu, type MenuItem, type MenuPosition } from '../Common/Menu';
import { FileTreeRename } from './FileTreeRename';
import { t } from '../../i18n';
import { createCalendarBaseFile } from '../../modules/bases/createCalendarBaseFile';
import { scanKanbanBoards, type KanbanBoard } from '../../modules/bases';
import { isBasePath, readDirectory, readFileSnapshot, trashFile } from '../../modules/documents/fileGateway';
import { renameWorkspaceFile } from '../../modules/documents/renameWorkspaceFile';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { WORKSPACE_CHANGED_EVENT } from '../../hooks/useWorkspaceEvents';
import './CalendarPanel.css';

interface CalendarPanelProps {
  active: boolean;
  workspacePath: string | null;
  onOpenView: (path: string, index: number) => void;
}

interface CalendarGroup {
  path: string;
  name: string;
  views: { index: number; name: string }[];
}

function calendarGroups(boards: readonly KanbanBoard[]): CalendarGroup[] {
  return boards.flatMap((board) => {
    const views = board.views
      .filter((view) => view.type === 'calendar')
      .map((view) => ({ index: view.index, name: view.name }));
    return views.length > 0 ? [{ path: board.path, name: board.name, views }] : [];
  });
}

export function CalendarPanel({ active, workspacePath, onOpenView }: CalendarPanelProps) {
  const revision = useRef(0);
  const workspacePathRef = useRef(workspacePath);
  const activeRef = useRef(active);
  const workspaceRevision = useRef(0);
  const mounted = useRef(true);
  const createPending = useRef(false);
  const actionPendingRef = useRef(false);
  const [groups, setGroups] = useState<CalendarGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [creating, setCreating] = useState(false);
  const [menu, setMenu] = useState<{ group: CalendarGroup; position: MenuPosition } | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalendarGroup | null>(null);
  const [actionPending, setActionPending] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspacePath) {
      setGroups([]);
      return;
    }
    const current = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const boards = await scanKanbanBoards(workspacePath, readDirectory, readFileSnapshot);
      if (current === revision.current) setGroups(calendarGroups(boards));
    } catch (cause) {
      console.error('Failed to scan calendar Bases', cause);
      if (current === revision.current) setError(String(cause));
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [workspacePath]);

  const createCalendar = async () => {
    const targetWorkspace = workspacePath;
    if (!targetWorkspace || createPending.current) return;
    const targetRevision = workspaceRevision.current;
    createPending.current = true;
    setCreating(true);
    setActionError('');
    try {
      const path = await createCalendarBaseFile(targetWorkspace);
      if (!mounted.current || workspacePathRef.current !== targetWorkspace
        || workspaceRevision.current !== targetRevision) return;
      if (!path) {
        setActionError(t('calendarPanel.nameExhausted'));
        return;
      }
      onOpenView(path, 0);
    } catch (cause) {
      if (mounted.current && workspacePathRef.current === targetWorkspace
        && workspaceRevision.current === targetRevision) {
        setActionError(t('calendarPanel.createError', { reason: String(cause) }));
      }
    } finally {
      createPending.current = false;
      if (mounted.current) setCreating(false);
    }
  };

  useEffect(() => {
    if (!active) return;
    void refresh();
  }, [active, refresh]);

  useLayoutEffect(() => {
    if (workspacePathRef.current === workspacePath && activeRef.current === active) return;
    workspacePathRef.current = workspacePath;
    activeRef.current = active;
    workspaceRevision.current += 1;
    revision.current += 1;
    setMenu(null);
    setRenamingPath(null);
    setDeleteTarget(null);
    setActionError('');
  }, [active, workspacePath]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revision.current += 1;
    };
  }, []);

  useTauriEvent<string[]>(WORKSPACE_CHANGED_EVENT, (paths) => {
    if (!paths.some(isBasePath)) return;
    void refresh();
  }, active);

  const items: MenuItem[] = menu ? [
    { id: 'open', label: t('fileTree.open'), icon: ExternalLink, onSelect: () => onOpenView(menu.group.path, menu.group.views[0]!.index) },
    { id: 'rename', label: t('common.rename'), icon: Pencil, onSelect: () => setRenamingPath(menu.group.path) },
    { id: 'delete', label: t('common.delete'), icon: Trash2, danger: true, onSelect: () => { setActionError(''); setDeleteTarget(menu.group); } },
  ] : [];

  const commitRename = async (group: CalendarGroup, name: string) => {
    setRenamingPath(null);
    if (!name.trim()) return;
    const currentRevision = workspaceRevision.current;
    try {
      const renamed = await renameWorkspaceFile(group.path, name);
      if (currentRevision !== workspaceRevision.current) return;
      if (renamed) await refresh();
    } catch (cause) {
      if (currentRevision === workspaceRevision.current) setActionError(t('fileTree.renameFailed', { name }));
      console.error('Failed to rename calendar Base', cause);
    }
  };

  const confirmDelete = async () => {
    if (!workspacePath || !deleteTarget || actionPendingRef.current) return;
    const currentRevision = workspaceRevision.current;
    const currentWorkspace = workspacePath;
    actionPendingRef.current = true;
    setActionPending(true);
    setActionError('');
    try {
      await trashFile(currentWorkspace, deleteTarget.path);
      if (currentRevision !== workspaceRevision.current) return;
      setDeleteTarget(null);
      await refresh();
    } catch (cause) {
      if (currentRevision === workspaceRevision.current) {
        setActionError(t('fileTree.deleteFailed', { reason: deleteTarget.path }));
      }
      console.error('Failed to delete calendar Base', cause);
    } finally {
      actionPendingRef.current = false;
      setActionPending(false);
    }
  };

  return (
    <section className="q-calendar-panel" aria-label={t('calendarPanel.title')}>
      <header className="q-calendar-panel__header">
        <h2>{t('calendarPanel.title')}</h2>
        <Button size="s" disabled={!workspacePath || creating} onClick={() => { void createCalendar(); }}>
          {creating ? t('calendarPanel.creating') : t('calendarPanel.create')}
        </Button>
      </header>
      {actionError ? <p role="alert">{actionError}</p> : null}
      {loading && groups.length === 0 ? <p>{t('calendarPanel.loading')}</p> : null}
      {error ? <p role="alert">{t('error.recoveryFailed', { reason: error })}</p> : null}
      {!loading && !error && groups.length === 0 ? <p>{t('calendarPanel.empty')}</p> : null}
      {groups.length > 0 ? (
        <ul className="q-calendar-panel__list">
          {groups.map((group) => (
            <li className="q-calendar-panel__base" key={group.path}>
              {renamingPath === group.path ? (
                <FileTreeRename
                  name={group.name}
                  className="q-calendar-panel__name"
                  active
                  onCommit={(name) => { void commitRename(group, name); }}
                  onCancel={() => setRenamingPath(null)}
                />
              ) : (
                <div className="q-calendar-panel__heading">
                  <strong
                    className="q-calendar-panel__name"
                    title={group.path}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setMenu({ group, position: { left: event.clientX, top: event.clientY } });
                    }}
                  >
                    {group.name}
                  </strong>
                  <IconButton
                    label={t('boards.actions', { name: group.name })}
                    size="small"
                    aria-haspopup="menu"
                    aria-expanded={menu?.group.path === group.path}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({ group, position: { left: rect.right, top: rect.bottom } });
                    }}
                  >
                    <Icon icon={MoreHorizontal} />
                  </IconButton>
                </div>
              )}
              {group.views.map((view) => (
                <button
                  key={`${group.path}:${view.index}`}
                  type="button"
                  className="q-calendar-panel__view"
                  title={group.path}
                  onClick={() => onOpenView(group.path, view.index)}
                >
                  <Icon icon="calendar" />
                  <span>{view.name}</span>
                </button>
              ))}
            </li>
          ))}
        </ul>
      ) : null}
      <Menu open={Boolean(menu)} position={menu?.position ?? null} items={items} onClose={() => setMenu(null)} />
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={t('common.delete')}
        description={deleteTarget?.path ?? ''}
        error={actionError || undefined}
        confirmLabel={t('common.delete')}
        pending={actionPending}
        onCancel={() => { setDeleteTarget(null); setActionError(''); }}
        onConfirm={() => { void confirmDelete(); }}
      />
    </section>
  );
}
