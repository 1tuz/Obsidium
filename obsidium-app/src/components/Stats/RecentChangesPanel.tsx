import { useEffect, useState } from 'preact/hooks';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { getLocale, t } from '../../i18n';
import { LINKS_CHANGED_EVENT, type IndexRevisionEvent } from '../../modules/links/events';
import { samePath } from '../../modules/paths';
import {
  formatNoteMoment,
  loadRecentChanges,
  RECENT_CHANGES_LIMIT,
  type ActivityNote,
} from '../../modules/stats';
import { ActivityNoteRow } from './ActivityNoteRow';
import './RecentChangesPanel.css';

type FeedState =
  | { status: 'loading' }
  | { status: 'ready'; notes: ActivityNote[] }
  | { status: 'failed'; reason: string };

export interface RecentChangesPanelProps {
  workspacePath: string | null;
  onOpenNote?: (path: string) => void;
  limit?: number;
}

export function RecentChangesPanel({
  workspacePath,
  onOpenNote,
  limit = RECENT_CHANGES_LIMIT,
}: RecentChangesPanelProps) {
  const [state, setState] = useState<FeedState>({ status: 'loading' });
  const [revision, setRevision] = useState(0);

  useTauriEvent<IndexRevisionEvent>(
    LINKS_CHANGED_EVENT,
    (payload) => {
      if (samePath(payload.workspacePath, workspacePath)) setRevision((value) => value + 1);
    },
    workspacePath !== null,
  );

  useEffect(() => {
    if (!workspacePath) {
      setState({ status: 'ready', notes: [] });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    loadRecentChanges(workspacePath, limit)
      .then((notes) => {
        if (active) setState({ status: 'ready', notes });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      active = false;
    };
  }, [workspacePath, limit, revision]);

  if (!workspacePath) return null;
  const locale = getLocale();

  return (
    <section
      className="q-recent-changes"
      aria-label={t('stats.activity.recentTitle')}
      aria-busy={state.status === 'loading'}
    >
      <header className="q-recent-changes__header">
        <h2 className="q-recent-changes__title">{t('stats.activity.recentTitle')}</h2>
      </header>
      {state.status === 'loading' && (
        <p className="q-recent-changes__status">{t('stats.activity.recentLoading')}</p>
      )}
      {state.status === 'failed' && (
        <p className="q-recent-changes__status" role="alert">
          {t('stats.activity.recentFailed', { reason: state.reason })}
        </p>
      )}
      {state.status === 'ready' && (state.notes.length === 0 ? (
        <p className="q-recent-changes__status">{t('stats.activity.recentEmpty')}</p>
      ) : (
        <ul className="q-recent-changes__rows">
          {state.notes.map((note) => (
            <ActivityNoteRow
              key={note.path}
              path={note.path}
              detail={formatNoteMoment(note.timestampNs, locale)}
              workspacePath={workspacePath}
              onOpenNote={onOpenNote}
            />
          ))}
        </ul>
      ))}
    </section>
  );
}
