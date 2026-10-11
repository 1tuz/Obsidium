import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LanguageDescription, defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { CodeMirrorView } from '../Common/CodeMirrorView';
import { obsidiumCodeMirrorTheme, obsidiumFieldSetup } from '../Common/codeMirror';
import { isFileCommandError, readFileSnapshot, writeFileAtomic } from '../../modules/documents/fileGateway';
import { fileName } from '../../modules/paths';
import { t } from '../../i18n';
import './TextFilePane.css';

type SaveState = 'loading' | 'saved' | 'saving' | 'conflict' | 'error';

export function TextFilePane({ path, inactive }: { path: string; inactive: boolean }) {
  const viewRef = useRef<EditorView>(null);
  const hashRef = useRef('');
  const latestContentRef = useRef('');
  const saveQueueRef = useRef(Promise.resolve());
  const timerRef = useRef<number | null>(null);
  const stateRef = useRef<SaveState>('loading');
  const [state, setState] = useState<SaveState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [language, setLanguage] = useState<Extension[]>([]);
  const extensions = useMemo<Extension[]>(() => [
    obsidiumFieldSetup,
    obsidiumCodeMirrorTheme,
    syntaxHighlighting(defaultHighlightStyle),
    language,
  ], [language]);

  useEffect(() => {
    const extension = path.split('.').pop()?.toLowerCase() ?? '';
    const description = LanguageDescription.matchLanguageName(languages, extension, true);
    setLanguage([]);
    if (!description) return undefined;
    let cancelled = false;
    void description.load().then((support) => {
      if (!cancelled) setLanguage([support]);
    }).catch((cause) => console.error('Failed to load text file language', cause));
    return () => { cancelled = true; };
  }, [path]);

  const setSaveState = useCallback((next: SaveState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const enqueueSave = useCallback((content: string) => {
    if (stateRef.current === 'conflict') return;
    setSaveState('saving');
    saveQueueRef.current = saveQueueRef.current.then(async () => {
      if (stateRef.current === 'conflict') return;
      const result = await writeFileAtomic(path, content, hashRef.current);
      hashRef.current = result.hash;
      setSaveState('saved');
    }).catch((cause) => {
      setError(String(cause));
      setSaveState(isFileCommandError(cause, 'conflict') ? 'conflict' : 'error');
    });
  }, [path, setSaveState]);

  useEffect(() => {
    let cancelled = false;
    void readFileSnapshot(path).then((snapshot) => {
      if (cancelled) return;
      hashRef.current = snapshot.hash;
      latestContentRef.current = snapshot.content;
      setSaveState('saved');
      viewRef.current?.dispatch({
        changes: { from: 0, to: viewRef.current.state.doc.length, insert: snapshot.content },
      });
    }).catch((cause) => {
      if (cancelled) return;
      setError(String(cause));
      setSaveState(isFileCommandError(cause, 'conflict') ? 'conflict' : 'error');
    });
    return () => {
      cancelled = true;
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        if (stateRef.current !== 'conflict') enqueueSave(latestContentRef.current);
      }
    };
  }, [enqueueSave, path, setSaveState]);

  const handleUpdate = useCallback((update: ViewUpdate) => {
    if (!update.docChanged || stateRef.current === 'loading' || stateRef.current === 'conflict') return;
    latestContentRef.current = update.state.doc.toString();
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      enqueueSave(latestContentRef.current);
    }, 700);
  }, [enqueueSave]);

  const reload = useCallback(async () => {
    const snapshot = await readFileSnapshot(path);
    hashRef.current = snapshot.hash;
    latestContentRef.current = snapshot.content;
    setError(null);
    setSaveState('saved');
    const view = viewRef.current;
    if (view) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: snapshot.content } });
  }, [path, setSaveState]);

  return (
    <section className={`q-text-file-pane${inactive ? ' q-offstage' : ''}`} aria-hidden={inactive}>
      <header className="q-text-file-pane__header">
        <span className="q-text-file-pane__name">{fileName(path)}</span>
        <span className="q-text-file-pane__status" aria-live="polite">
          {state === 'loading' ? t('editor.fileLoading')
            : state === 'saving' ? t('editor.fileSaving')
              : state === 'saved' ? t('editor.fileSaved')
                : state === 'conflict' ? t('editor.fileConflict') : t('editor.fileError')}
        </span>
        {(state === 'conflict' || state === 'error') && (
          <button type="button" className="q-text-file-pane__reload" onClick={() => {
            void reload().catch((cause) => setError(String(cause)));
          }}>
            {t('editor.fileReload')}
          </button>
        )}
      </header>
      {error && <p className="q-text-file-pane__error">{error}</p>}
      <CodeMirrorView
        viewRef={viewRef}
        doc=""
        className="q-text-file-pane__editor"
        extensions={extensions}
        onUpdate={handleUpdate}
      />
    </section>
  );
}
