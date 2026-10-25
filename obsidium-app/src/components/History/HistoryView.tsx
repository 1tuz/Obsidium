import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatDateTime, t } from '../../i18n';
import {
  applyFromHistory,
  closeVersion,
  readNoteVersion,
  rememberScroll,
  restoreVersion,
  revertVersion,
  revertVersionChunk,
  versionTitle,
  type NoteVersion,
  type OpenedVersion,
  type Rewrite,
  type VersionChunk,
} from '../../modules/history';
import { Menu } from '../Common/Menu';
import { TextButton } from '../Common/TextButton';
import { useSelectionMenu } from '../Common/useSelectionMenu';
import type { VersionEditor } from './versionEditor';
import './HistoryView.css';

type Status = 'loading' | 'ready' | 'missing';
type Action = 'idle' | 'running' | 'failed';

interface HistoryViewProps {
  tabId: string;
  opened: OpenedVersion;
}

function heading(version: NoteVersion): string {
  const named = version.name === null ? '' : `${version.name} · `;
  return `${named}${versionTitle(version)} · ${formatDateTime(version.atMs)}`;
}

export function HistoryView({ tabId, opened }: HistoryViewProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<VersionEditor | null>(null);
  const menu = useSelectionMenu(useCallback(() => editorRef.current?.view ?? null, []));
  const [status, setStatus] = useState<Status>('loading');
  const [action, setAction] = useState<Action>('idle');
  const [hasPrevious, setHasPrevious] = useState(false);
  const running = useRef(false);
  const { path, version } = opened;

  const revertChunk = useCallback((chunk: VersionChunk) => {
    if (running.current) return;
    running.current = true;
    setAction('running');
    void revertVersionChunk(path, version, chunk).then((done) => {
      if (done) editorRef.current?.markReverted(chunk);
      setAction(done ? 'idle' : 'failed');
    }).catch((error) => {
      console.error('Failed to revert a part of the note version', error);
      setAction('failed');
    }).finally(() => {
      running.current = false;
    });
  }, [path, version]);

  useEffect(() => {
    let disposed = false;
    let view: VersionEditor | null = null;
    setStatus('loading');
    setAction('idle');
    void Promise.all([readNoteVersion(path, version.id), import('./versionEditor')]).then(([texts, editor]) => {
      if (disposed) return;
      if (!texts || !hostRef.current) {
        setStatus('missing');
        return;
      }
      view = editor.createVersionEditor(hostRef.current, texts, { onRevertChunk: revertChunk });
      editorRef.current = view;
      setHasPrevious(texts.previous !== null);
      setStatus('ready');
    }).catch((error) => {
      console.error('Failed to open the note version', error);
      if (!disposed) setStatus('missing');
    });
    return () => {
      disposed = true;
      editorRef.current = null;
      view?.destroy();
    };
  }, [path, version, revertChunk]);

  useLayoutEffect(() => {
    if (status === 'ready' && scrollerRef.current) scrollerRef.current.scrollTop = opened.scrollTop;
  }, [opened, status]);

  const run = (rewrite: Rewrite, target: NoteVersion) => {
    if (running.current) return;
    running.current = true;
    setAction('running');
    void applyFromHistory(rewrite, path, target, tabId).then((done) => {
      if (!done) setAction('failed');
    }).catch((error) => {
      console.error('Failed to change the note from its history', error);
      setAction('failed');
    }).finally(() => {
      running.current = false;
    });
  };
  const busy = status !== 'ready' || action === 'running';

  return (
    <section className="q-history-view" aria-label={t('history.viewLabel')}>
      <header className="q-history-view__bar">
        <span className="q-history-view__title">{heading(version)}</span>
        <div className="q-history-view__actions">
          {hasPrevious && (
            <TextButton disabled={busy} onClick={() => run(revertVersion, version)}>
              {t('history.revert')}
            </TextButton>
          )}
          <TextButton
            disabled={busy || version.isCurrent}
            onClick={() => run(restoreVersion, version)}
          >
            {t('history.restore')}
          </TextButton>
          <TextButton onClick={() => closeVersion(tabId)}>{t('history.back')}</TextButton>
        </div>
      </header>
      <div
        ref={scrollerRef}
        className="q-editor-container q-history-view__scroller"
        onScroll={(event) => rememberScroll(tabId, event.currentTarget.scrollTop)}
      >
        {status === 'missing' && <p className="q-history-view__notice">{t('history.missing')}</p>}
        {action === 'failed' && <p className="q-history-view__notice">{t('history.actionFailed')}</p>}
        <div
          ref={hostRef}
          className={status === 'ready' ? 'q-editor-content' : 'q-editor-content q-history-view__content--waiting'}
          onContextMenu={menu.onContextMenu}
        />
      </div>
      {menu.open && (
        <Menu
          open
          position={menu.position}
          items={[menu.copy, menu.selectAll]}
          onClose={menu.close}
          ariaLabel={t('history.viewLabel')}
        />
      )}
    </section>
  );
}
