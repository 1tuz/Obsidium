// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { formatDateTime, t } from '../../i18n';
import type { BookBookmark } from '../../modules/docs/bookBookmarks';
import type { ReaderTocItem } from './readerToc';
import { ReaderPanel } from './ReaderPanel';

const toc: ReaderTocItem[] = [
  { id: 1, label: 'Cover', href: 'epubcfi(/6/2)', depth: 0 },
  { id: 2, label: 'Chapter One', href: 'epubcfi(/6/4)', depth: 0 },
  { id: 3, label: 'Section', href: null, depth: 1 },
];

const createdAt = '2026-10-25T09:00:00.000Z';

const bookmarks: BookBookmark[] = [
  { cfi: 'epubcfi(/6/4!/4)', chapter: 'Chapter One', note: 'Remember this', createdAt },
  { cfi: 'epubcfi(/6/6!/2)', chapter: '', createdAt },
];

interface RenderOptions {
  open?: boolean;
  toc?: readonly ReaderTocItem[];
  activeTocId?: number | null;
  bookmarks?: readonly BookBookmark[];
}

function renderPanel(options: RenderOptions = {}) {
  const onSelectToc = vi.fn();
  const onSelectBookmark = vi.fn();
  const onRemoveBookmark = vi.fn();
  const onClose = vi.fn();
  const renderer = mountDom(
    <ReaderPanel
      open={options.open ?? true}
      toc={options.toc ?? toc}
      activeTocId={options.activeTocId ?? null}
      bookmarks={options.bookmarks ?? bookmarks}
      onSelectToc={onSelectToc}
      onSelectBookmark={onSelectBookmark}
      onRemoveBookmark={onRemoveBookmark}
      onClose={onClose}
    />,
  );
  return { renderer, onSelectToc, onSelectBookmark, onRemoveBookmark, onClose };
}

describe('ReaderPanel', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('renders nothing when closed', async () => {
    const mounted = renderPanel({ open: false });
    renderer = mounted.renderer;
    await actAndSettle();

    expect(renderer.container.querySelector('.q-reader-panel')).toBeNull();
    expect(renderer.container.textContent).toBe('');
  });

  it('renders the table of contents in order', async () => {
    const mounted = renderPanel();
    renderer = mounted.renderer;
    await actAndSettle();

    const labels = Array.from(
      renderer.container.querySelectorAll('.q-reader-toc-item'),
      (node) => node.textContent,
    );
    expect(labels).toEqual(['Cover', 'Chapter One', 'Section']);
  });

  it('calls onSelectToc with the clicked item', async () => {
    const mounted = renderPanel();
    renderer = mounted.renderer;
    await actAndSettle();

    const buttons = renderer.container.querySelectorAll<HTMLButtonElement>('.q-reader-toc-item');
    await actAndSettle(() => buttons[1].click());

    expect(mounted.onSelectToc).toHaveBeenCalledTimes(1);
    expect(mounted.onSelectToc).toHaveBeenCalledWith(toc[1]);
  });

  it('marks the active item with aria-current', async () => {
    const mounted = renderPanel({ activeTocId: 2 });
    renderer = mounted.renderer;
    await actAndSettle();

    const active = renderer.container.querySelector('.q-reader-toc-item[aria-current="location"]');
    expect(active?.textContent).toBe('Chapter One');
    expect(renderer.container.querySelectorAll('[aria-current="location"]').length).toBe(1);
  });

  it('disables entries without a target', async () => {
    const mounted = renderPanel();
    renderer = mounted.renderer;
    await actAndSettle();

    const buttons = renderer.container.querySelectorAll<HTMLButtonElement>('.q-reader-toc-item');
    expect(buttons[2].disabled).toBe(true);
    expect(buttons[0].disabled).toBe(false);
    expect(buttons[1].disabled).toBe(false);
  });

  it('renders bookmark chapter, note and date', async () => {
    const mounted = renderPanel();
    renderer = mounted.renderer;
    await actAndSettle();

    const rows = renderer.container.querySelectorAll('.q-reader-bookmark');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.q-reader-bookmark-chapter')?.textContent).toBe('Chapter One');
    expect(rows[0].querySelector('.q-reader-bookmark-note')?.textContent).toBe('Remember this');
    expect(rows[0].querySelector('.q-reader-bookmark-date')?.textContent)
      .toBe(formatDateTime(Date.parse(createdAt)));
    expect(rows[1].querySelector('.q-reader-bookmark-note')).toBeNull();
    expect(rows[1].querySelector('.q-reader-bookmark-chapter')?.textContent).toBe(t('reader.book'));
  });

  it('calls onRemoveBookmark from the remove button', async () => {
    const mounted = renderPanel();
    renderer = mounted.renderer;
    await actAndSettle();

    const remove = renderer.container.querySelector<HTMLButtonElement>(
      `.q-reader-bookmark [aria-label="${t('reader.removeBookmark')}"]`,
    );
    expect(remove).not.toBeNull();
    await actAndSettle(() => remove!.click());

    expect(mounted.onRemoveBookmark).toHaveBeenCalledTimes(1);
    expect(mounted.onRemoveBookmark).toHaveBeenCalledWith(bookmarks[0]);
  });

  it('renders empty states for both empty lists', async () => {
    const mounted = renderPanel({ toc: [], bookmarks: [] });
    renderer = mounted.renderer;
    await actAndSettle();

    const titles = Array.from(
      renderer.container.querySelectorAll('.q-empty-state__title'),
      (node) => node.textContent,
    );
    expect(titles).toEqual([t('reader.noContents'), t('reader.noBookmarks')]);
    expect(renderer.container.querySelector('.q-reader-toc')).toBeNull();
    expect(renderer.container.querySelector('.q-reader-bookmarks')).toBeNull();
  });
});
