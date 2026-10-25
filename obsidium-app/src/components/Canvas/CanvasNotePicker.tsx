import { useEffect, useRef, useState } from 'react';
import { DatabaseZap, FilePlus2, FileText, FolderSearch, Search, SearchX } from 'lucide';
import { t } from '../../i18n';
import { useKnowledgeSearch, type SearchResult } from '../../modules/search';
import { loadRecentCanvasNotes, type CanvasRecentNote } from '../../modules/canvas/recentNotes';
import { EmptyState } from '../Common/EmptyState';
import { Icon } from '../Common/Icon';
import { CodeMirrorField, type CodeMirrorFieldRef } from '../Common/CodeMirrorField';
import { Dialog } from '../Common/Dialog';
import { ScrollArea } from '../Common/ScrollArea';
import { SearchResultCard } from '../Search/SearchResultCard';
import { appendQueryTermToField } from '../Search/queryField';
import './CanvasNotePicker.css';

interface CanvasNotePickerProps {
  open: boolean;
  workspacePath: string;
  onClose: () => void;
  onSelect: (path: string) => void;
  onCreate?: (title: string) => void;
}

type PickerRow =
  | { kind: 'create'; title: string }
  | { kind: 'result'; result: SearchResult }
  | { kind: 'recent'; note: CanvasRecentNote };

export function CanvasNotePicker({
  open,
  workspacePath,
  onClose,
  onSelect,
  onCreate,
}: CanvasNotePickerProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentNotes, setRecentNotes] = useState<CanvasRecentNote[]>([]);
  const inputRef = useRef<CodeMirrorFieldRef>(null);
  const resultListRef = useRef<HTMLDivElement>(null);
  const search = useKnowledgeSearch({ open, query, workspacePath });

  const trimmed = query.trim();
  const results = search.results.filter((result) => result.extension.toLowerCase() === 'md');
  const exactMatch = results.some(
    (result) => result.title.trim().toLowerCase() === trimmed.toLowerCase(),
  );
  const rows: PickerRow[] = trimmed
    ? [
        ...(exactMatch ? [] : [{ kind: 'create' as const, title: trimmed }]),
        ...results.map((result) => ({ kind: 'result' as const, result })),
      ]
    : recentNotes.map((note) => ({ kind: 'recent' as const, note }));

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [open]);

  useEffect(() => setSelectedIndex(0), [query]);

  useEffect(() => {
    setSelectedIndex((index) => Math.min(index, Math.max(0, rows.length - 1)));
  }, [rows.length]);

  useEffect(() => {
    if (!open || !workspacePath) {
      setRecentNotes([]);
      return;
    }
    let active = true;
    void loadRecentCanvasNotes(workspacePath)
      .then((notes) => {
        if (active) setRecentNotes(notes);
      })
      .catch(() => {
        if (active) setRecentNotes([]);
      });
    return () => {
      active = false;
    };
  }, [open, workspacePath]);

  useEffect(() => {
    resultListRef.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedIndex]);

  const activate = (index: number) => {
    const row = rows[index];
    if (!row) return;
    if (row.kind === 'create') onCreate?.(row.title);
    else if (row.kind === 'result') onSelect(row.result.path);
    else onSelect(row.note.path);
    onClose();
  };

  const addQueryTerm = (term: string) => {
    setQuery(appendQueryTermToField(inputRef.current, query, term));
  };

  const content = !workspacePath ? (
    <EmptyState
      icon={FolderSearch}
      title={t('search.noFolder')}
      description={t('search.noFolderHint')}
    />
  ) : search.failed || search.status.state === 'error' ? (
    <EmptyState
      icon={DatabaseZap}
      title={t('search.unavailable')}
      description={t('search.unavailableHint')}
    />
  ) : (
    <>
      {!trimmed && rows.length > 0 ? (
        <div className="q-canvas-note-picker__section" role="presentation">
          {t('canvas.search.recent')}
        </div>
      ) : null}
      {rows.map((row, index) => {
        if (row.kind === 'result') {
          return (
            <SearchResultCard
              key={row.result.path}
              result={row.result}
              queryTerms={search.queryTerms}
              selected={index === selectedIndex}
              onHover={() => setSelectedIndex(index)}
              onSelect={() => activate(index)}
              onAddQueryTerm={addQueryTerm}
            />
          );
        }
        const selected = index === selectedIndex;
        return (
          <button
            key={row.kind === 'create' ? 'create' : row.note.path}
            type="button"
            role="option"
            aria-selected={selected}
            className={`q-search-result q-canvas-note-picker__${row.kind}${selected ? ' is-selected' : ''}`}
            onMouseEnter={() => setSelectedIndex(index)}
            onClick={() => activate(index)}
          >
            <span className="q-search-result__header">
              <span className="q-search-result__identity">
                <Icon
                  icon={row.kind === 'create' ? FilePlus2 : FileText}
                  className="q-search-result__icon"
                />
                <span className="q-search-result__filename">
                  <span className="q-search-result__title">
                    {row.kind === 'create'
                      ? t('canvas.search.create', { query: row.title })
                      : row.note.title}
                  </span>
                </span>
              </span>
            </span>
            {row.kind === 'recent' && row.note.folder ? (
              <span className="q-search-result__snippet">{row.note.folder}</span>
            ) : null}
          </button>
        );
      })}
      {trimmed && results.length === 0 ? (
        <EmptyState icon={SearchX} title={t('canvas.search.empty')} />
      ) : null}
      {!trimmed && rows.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t('search.title')}
          description={t('search.titleHint')}
        />
      ) : null}
    </>
  );

  return (
    <Dialog
      open={open}
      title={t('canvas.search.title')}
      headerless
      className="q-search-dialog q-canvas-note-picker"
      initialFocus={() => inputRef.current?.select()}
      onClose={onClose}
    >
      <div className="q-search-box">
        <CodeMirrorField
          ref={inputRef}
          className="q-search-input q-canvas-search-input"
          value={query}
          onChange={setQuery}
          placeholder={t('canvas.search.placeholder')}
          ariaLabel={t('canvas.search.placeholder')}
          mode="single-line"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setSelectedIndex((index) => rows.length
                ? (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
                : 0);
            } else if (event.key === 'Enter') {
              event.preventDefault();
              activate(selectedIndex);
            }
          }}
        />
      </div>
      <ScrollArea
        ref={resultListRef}
        className="q-search-results"
        role="listbox"
        aria-label={t('search.resultsAria')}
      >
        {content}
      </ScrollArea>
    </Dialog>
  );
}
