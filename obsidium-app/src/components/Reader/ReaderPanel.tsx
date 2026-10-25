import { Bookmark, List, Trash2, X } from 'lucide';
import { formatDateTime, t } from '../../i18n';
import type { BookBookmark } from '../../modules/docs/bookBookmarks';
import { EmptyState } from '../Common/EmptyState';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { ScrollArea } from '../Common/ScrollArea';
import type { ReaderTocItem } from './readerToc';

interface ReaderPanelProps {
  open: boolean;
  toc: readonly ReaderTocItem[];
  activeTocId: number | null;
  bookmarks: readonly BookBookmark[];
  onSelectToc: (item: ReaderTocItem) => void;
  onSelectBookmark: (bookmark: BookBookmark) => void;
  onRemoveBookmark: (bookmark: BookBookmark) => void;
  onClose: () => void;
}

function bookmarkDate(bookmark: BookBookmark): string {
  const ts = Date.parse(bookmark.createdAt);
  return Number.isNaN(ts) ? '' : formatDateTime(ts);
}

export function ReaderPanel({
  open,
  toc,
  activeTocId,
  bookmarks,
  onSelectToc,
  onSelectBookmark,
  onRemoveBookmark,
  onClose,
}: ReaderPanelProps) {
  if (!open) return null;

  return (
    <aside className="q-reader-panel" aria-label={t('reader.contents')}>
      <div className="q-reader-panel-head">
        <span className="q-reader-panel-title">{t('reader.contents')}</span>
        <IconButton size="small" label={t('reader.panelClose')} onClick={onClose}>
          <Icon icon={X} />
        </IconButton>
      </div>
      <ScrollArea className="q-reader-panel-body">
        <section className="q-reader-panel-section">
          <h3 className="q-reader-panel-section-title">{t('reader.toc')}</h3>
          {toc.length ? (
            <nav aria-label={t('reader.toc')}>
              <ul className="q-reader-toc">
                {toc.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="q-reader-toc-item"
                      aria-current={activeTocId === item.id ? 'location' : undefined}
                      disabled={item.href === null}
                      style={{ paddingInlineStart: `calc(var(--q-space-8) + ${item.depth} * var(--q-space-12))` }}
                      onClick={() => onSelectToc(item)}
                    >
                      {item.label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : (
            <EmptyState compact icon={List} title={t('reader.noContents')} />
          )}
        </section>
        <section className="q-reader-panel-section">
          <h3 className="q-reader-panel-section-title">{t('reader.bookmarks')}</h3>
          {bookmarks.length ? (
            <ul className="q-reader-bookmarks">
              {bookmarks.map((bookmark) => (
                <li key={bookmark.cfi} className="q-reader-bookmark">
                  <button
                    type="button"
                    className="q-reader-bookmark-open"
                    onClick={() => onSelectBookmark(bookmark)}
                  >
                    <span className="q-reader-bookmark-chapter">
                      {bookmark.chapter || t('reader.book')}
                    </span>
                    {bookmark.note && <span className="q-reader-bookmark-note">{bookmark.note}</span>}
                    <span className="q-reader-bookmark-date">{bookmarkDate(bookmark)}</span>
                  </button>
                  <IconButton
                    size="small"
                    label={t('reader.removeBookmark')}
                    onClick={() => onRemoveBookmark(bookmark)}
                  >
                    <Icon icon={Trash2} />
                  </IconButton>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState compact icon={Bookmark} title={t('reader.noBookmarks')} />
          )}
        </section>
      </ScrollArea>
    </aside>
  );
}
