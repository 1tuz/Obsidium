import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../Common/Button';
import { Icon } from '../Common/Icon';
import { t } from '../../i18n';
import { createCalendarBaseFile } from '../../modules/bases/createCalendarBaseFile';
import { scanKanbanBoards, type KanbanBoard } from '../../modules/bases';
import { isBasePath, readDirectory, readFileSnapshot } from '../../modules/documents/fileGateway';
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
  const [groups, setGroups] = useState<CalendarGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [creating, setCreating] = useState(false);

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
              <strong className="q-calendar-panel__name" title={group.path}>{group.name}</strong>
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
    </section>
  );
}
