import { t } from '../../i18n';
import { matchesShortcut, SHORTCUTS } from '../../config/shortcuts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, ChevronLeft, ChevronRight, List, Settings2, X } from 'lucide';
import { Icon } from '../Common/Icon';
import { Button } from '../Common/Button';
import { IconButton } from '../Common/IconButton';
import { useSettingsPersist } from '../Settings/useSettingsPersist';
import { useThemeMode } from '../../hooks/useThemeMode';
import { useStableCallback } from '../../hooks/useStableCallback';
import { FoliateReaderEngine, prefetchFoliate } from './ReaderEngine';
import { ReaderSettingsPopover } from './ReaderSettingsPopover';
import { ReaderPanel } from './ReaderPanel';
import { tocItemLabel, type ReaderTocItem } from './readerToc';
import { DEFAULT_READER_SETTINGS } from '../../modules/settings';
import { loadBookFile } from '../../modules/docs/books';
import type { BookQuoteRef } from '../../modules/docs/bookQuotes';
import {
  type BookBookmark,
  withBookmark,
  withoutBookmark,
} from '../../modules/docs/bookBookmarks';
import {
  persistBookReaderMeta,
  readBookmarks,
} from '../../modules/docs/persistBookReaderMeta';
import {
  currentFromFraction,
  formatPages,
  formatSyntheticPages,
  parsePages,
  type Pages,
} from '../../modules/docs/bookProgress';
import {
  flushReaderState,
  hydrateReaderState,
  resolveReaderOpenTarget,
  setReaderState,
} from '../../modules/docs/readerState';
import './BookReader.css';

interface BookReaderProps {
  workspacePath: string | null;
  bookFile: string;
  title?: string;
  pagesFm?: string;
  initialCfi?: string;
  peek?: boolean;
  quotes?: BookQuoteRef[];
  progressPagePath?: string;
  onClose: () => void;
  onPagesChange?: (pages: string, extra?: { cfi: string; readPercent: number }) => void;
  onQuote?: (text: string, cfi: string) => void;
  onQuoteRefClick?: (cfi: string) => void;
}

function pagesFromFm(pagesFm?: string): Pages {
  return parsePages(pagesFm) ?? { current: 0, total: 1 };
}

export function BookReader({
  workspacePath,
  bookFile,
  title,
  pagesFm,
  initialCfi,
  peek,
  quotes,
  progressPagePath,
  onClose,
  onPagesChange,
  onQuote,
  onQuoteRefClick,
}: BookReaderProps) {
  const { config, persist } = useSettingsPersist();
  const themeMode = useThemeMode();
  const readerSettings = config?.reader ?? DEFAULT_READER_SETTINGS;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [toc, setToc] = useState<ReaderTocItem[]>([]);
  const [activeTocId, setActiveTocId] = useState<number | null>(null);
  const [bookmarks, setBookmarks] = useState<BookBookmark[]>([]);
  const [currentCfi, setCurrentCfi] = useState<string | undefined>(undefined);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<FoliateReaderEngine | null>(null);

  const quoteMarks = useMemo(
    () => (quotes ?? [])
      .filter((quote) => !quote.bookFile || quote.bookFile === bookFile)
      .map((quote) => ({ cfi: quote.cfi, label: quote.label })),
    [quotes, bookFile],
  );
  const lastWritten = useRef(pagesFm ?? '');
  const totalRef = useRef(pagesFromFm(pagesFm).total);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pages, setPages] = useState<Pages>(() => pagesFromFm(pagesFm));
  const [selection, setSelection] = useState<{ text: string; cfi: string } | null>(null);

  const writePages = useStableCallback((next: Pages, cfi?: string) => {
    if (!onPagesChange) return;
    const formatted = formatPages(next.current, next.total);
    const readPercent = next.total > 0 ? Math.round((next.current / next.total) * 100) : 0;
    if (formatted === lastWritten.current && !cfi) return;
    lastWritten.current = formatted;
    onPagesChange(formatted, cfi ? { cfi, readPercent } : undefined);
  });

  const readOpenInputs = useStableCallback(() => ({ pagesFm, quoteMarks, readerSettings, themeMode }));
  const openQuoteRef = useStableCallback((cfi: string) => onQuoteRefClick?.(cfi));

  const writeBookmarks = useStableCallback((next: BookBookmark[]) => {
    setBookmarks(next);
    if (!progressPagePath) return;
    void persistBookReaderMeta(progressPagePath, { bookmarks: next }).catch((error) => {
      console.error('Failed to persist the book bookmarks', error);
    });
  });

  const toggleBookmark = useStableCallback(() => {
    const cfi = currentCfi;
    if (!cfi || !progressPagePath) return;
    if (bookmarks.some((bookmark) => bookmark.cfi === cfi)) {
      writeBookmarks(withoutBookmark(bookmarks, cfi));
      return;
    }
    writeBookmarks(withBookmark(bookmarks, {
      cfi,
      chapter: tocItemLabel(toc, activeTocId) || title || t('reader.book'),
      createdAt: new Date().toISOString(),
    }));
  });

  const openTocItem = useStableCallback((item: ReaderTocItem) => {
    setPanelOpen(false);
    void engineRef.current?.goToToc(item.id);
  });

  const openBookmark = useStableCallback((bookmark: BookBookmark) => {
    setPanelOpen(false);
    void engineRef.current?.goTo(bookmark.cfi);
  });

  const removeBookmark = useStableCallback((bookmark: BookBookmark) => {
    writeBookmarks(withoutBookmark(bookmarks, bookmark.cfi));
  });

  const handleKeyDown = useStableCallback((event: KeyboardEvent) => {
    const engine = engineRef.current;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (panelOpen) setPanelOpen(false);
      else if (settingsOpen) setSettingsOpen(false);
      else onClose();
      return;
    }
    if (settingsOpen || !engine) return;
    if (matchesShortcut(event, SHORTCUTS.READER_BOOKMARK)) {
      event.preventDefault();
      toggleBookmark();
      return;
    }
    if (matchesShortcut(event, SHORTCUTS.READER_NEXT_PAGE) || event.key === 'PageDown' || event.key === ' ') {
      event.preventDefault();
      void engine.next();
    }
    if (matchesShortcut(event, SHORTCUTS.READER_PREVIOUS_PAGE) || event.key === 'PageUp') {
      event.preventDefault();
      void engine.prev();
    }
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const engine = new FoliateReaderEngine(host);
    engine.applyStyle(readOpenInputs().readerSettings, readOpenInputs().themeMode);
    engineRef.current = engine;

    const unsubscribe = engine.onRelocate(({ fraction, cfi, tocId }) => {
      setCurrentCfi(cfi);
      setActiveTocId(typeof tocId === 'number' ? tocId : null);
      if (typeof fraction !== 'number' || !Number.isFinite(fraction)) return;
      const total = totalRef.current;
      const current = currentFromFraction(fraction, total);
      const next = { current, total };
      setPages((prev) => (prev.current === current && prev.total === total ? prev : next));
      writePages(next, cfi);
      if (!peek) setReaderState(bookFile, current, cfi);
    });
    const unsubSelection = engine.onSelection(setSelection);
    const unsubQuoteRef = engine.onQuoteRef(openQuoteRef);

    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelection(null);
    setToc([]);
    setActiveTocId(null);
    setBookmarks([]);
    setCurrentCfi(undefined);

    void (async () => {
      try {
        const [, loaded, , storedBookmarks] = await Promise.all([
          prefetchFoliate(),
          loadBookFile(workspacePath, bookFile),
          hydrateReaderState(workspacePath, bookFile),
          progressPagePath ? readBookmarks(progressPagePath) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setBookmarks(storedBookmarks);

        const latestPagesFm = readOpenInputs().pagesFm;
        const { pages: initial, formatted } = formatSyntheticPages(latestPagesFm, loaded.byteLength);
        totalRef.current = initial.total;
        lastWritten.current = formatted;
        setPages(initial);
        if (latestPagesFm !== formatted) writePages(initial);

        await engine.open(loaded.file, {
          lastLocation: resolveReaderOpenTarget(bookFile, initial, initialCfi),
        });
        if (cancelled) return;
        setToc([...engine.toc]);
        await engine.setQuotes(readOpenInputs().quoteMarks);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to open book', err);
        setError(err instanceof Error ? err.message : t('reader.openFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      cancelled = true;
      window.removeEventListener('keydown', handleKeyDown);
      unsubscribe();
      unsubSelection();
      unsubQuoteRef();
      engine.close();
      engineRef.current = null;
      void flushReaderState();
    };
  }, [bookFile, workspacePath, initialCfi, peek, progressPagePath, handleKeyDown, openQuoteRef, readOpenInputs, writePages]);

  useEffect(() => {
    void engineRef.current?.setQuotes(quoteMarks);
  }, [quoteMarks]);

  useEffect(() => {
    engineRef.current?.applyStyle(readerSettings, themeMode);
  }, [readerSettings, themeMode]);

  const patchReader = (partial: Partial<typeof readerSettings>) => {
    if (!config) return;
    persist({ ...config, reader: { ...config.reader, ...partial } });
  };

  const progressPct = pages.total > 0 ? (pages.current / pages.total) * 100 : 0;

  const applyQuote = () => {
    if (!selection || !onQuote) return;
    onQuote(selection.text, selection.cfi);
    setSelection(null);
  };

  return (
    <div className="q-book-reader" role="dialog" aria-modal="true" aria-label={t('reader.title')}>
      <header className="q-book-reader-bar">
        <div className="q-book-reader-heading">
          <div className="q-book-reader-title">{title || t('reader.book')}</div>
          <div className="q-book-reader-pages" aria-live="polite">
            {pages.current}/{pages.total}
          </div>
        </div>
        <div className="q-book-reader-actions">
          {progressPagePath ? (
            <IconButton
              size="medium"
              label={t('reader.addBookmark')}
              aria-pressed={bookmarks.some((bookmark) => bookmark.cfi === currentCfi)}
              onClick={toggleBookmark}
            >
              <Icon icon={Bookmark} />
            </IconButton>
          ) : null}
          <IconButton
            size="medium"
            label={t('reader.contents')}
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((open) => !open)}
          >
            <Icon icon={List} />
          </IconButton>
          <IconButton
            size="medium"
            label={t('reader.settings')}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Icon icon={Settings2} />
          </IconButton>
          <IconButton
            size="medium"
            label={t('reader.close')}
            onClick={onClose}
          >
            <Icon icon={X} />
          </IconButton>
        </div>
        {settingsOpen ? (
          <ReaderSettingsPopover
            settings={readerSettings}
            onChange={patchReader}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}
      </header>

      <div className="q-book-reader-body">
        <button
          type="button"
          className="q-book-reader-nav q-book-reader-nav--prev"
          title={t('reader.back')}
          aria-label={t('reader.prevPage')}
          onClick={() => void engineRef.current?.prev()}
        >
          <Icon icon={ChevronLeft} />
        </button>
        <button
          type="button"
          className="q-book-reader-nav q-book-reader-nav--next"
          title={t('reader.forward')}
          aria-label={t('reader.nextPage')}
          onClick={() => void engineRef.current?.next()}
        >
          <Icon icon={ChevronRight} />
        </button>

        {loading && <div className="q-book-reader-loading" aria-busy="true" />}
        {error && <div className="q-book-reader-status q-book-reader-status--error">{error}</div>}
        <div
          ref={hostRef}
          className="q-book-reader-host"
          hidden={Boolean(error)}
          data-loading={loading ? 'true' : undefined}
        />

        {selection && onQuote ? (
          <div className="q-book-reader-selection-toolbar">
            <p className="q-book-reader-selection-preview">{selection.text}</p>
            <Button size="s" className="q-book-reader-selection-action" onClick={applyQuote}>
              {t('reader.quote')}
            </Button>
          </div>
        ) : null}

        <ReaderPanel
          open={panelOpen}
          toc={toc}
          activeTocId={activeTocId}
          bookmarks={bookmarks}
          onSelectToc={openTocItem}
          onSelectBookmark={openBookmark}
          onRemoveBookmark={removeBookmark}
          onClose={() => setPanelOpen(false)}
        />
      </div>

      <footer className="q-book-reader-footer">
        <div
          className="q-book-reader-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressPct)}
          aria-label={t('reader.progress')}
        >
          <div className="q-book-reader-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="q-book-reader-pages q-book-reader-percent">{Math.round(progressPct)}%</div>
      </footer>
    </div>
  );
}
