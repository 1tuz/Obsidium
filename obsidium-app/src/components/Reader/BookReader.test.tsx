// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';

const harness = vi.hoisted(() => ({
  doc: '',
  relocate: null as null | ((location: { cfi?: string; fraction?: number; tocId?: number | null }) => void),
  goTo: [] as string[],
  goToToc: [] as number[],
}));

vi.mock('./ReaderEngine', () => ({
  prefetchFoliate: () => Promise.resolve(),
  FoliateReaderEngine: class {
    toc = [
      { id: 7, label: 'Chapter 1', href: 'ch1.xhtml', depth: 0 },
      { id: 9, label: 'Chapter 2', href: 'ch2.xhtml', depth: 0 },
    ];
    constructor(_host: HTMLElement) {}
    applyStyle() {}
    async open() {}
    close() {}
    async setQuotes() {}
    async next() {}
    async prev() {}
    async goTo(target: string) { harness.goTo.push(target); }
    async goToToc(id: number) { harness.goToToc.push(id); }
    onRelocate(listener: typeof harness.relocate) {
      harness.relocate = listener;
      return () => { harness.relocate = null; };
    }
    onSelection() { return () => {}; }
    onQuoteRef() { return () => {}; }
  },
}));

vi.mock('../../modules/docs/books', () => ({
  loadBookFile: () => Promise.resolve({ file: new File([new Uint8Array(8)], 'b.epub'), byteLength: 2048 }),
  hasBookFile: (value?: string) => Boolean(value),
}));

vi.mock('../../modules/docs/readerState', () => ({
  hydrateReaderState: () => Promise.resolve(null),
  resolveReaderOpenTarget: () => undefined,
  setReaderState: () => {},
  flushReaderState: () => Promise.resolve(),
}));

vi.mock('../../modules/documents/documentGateway', () => ({
  readDocument: () => Promise.resolve({ text: harness.doc, version: 1 }),
  rewriteDocument: async (
    _path: string,
    rewrite: (text: string) => string | null,
  ): Promise<boolean> => {
    const next = rewrite(harness.doc);
    if (next === null || next === harness.doc) return false;
    harness.doc = next;
    return true;
  },
}));

vi.mock('../Settings/useSettingsPersist', () => ({
  useSettingsPersist: () => ({ config: null, isLoading: false, persist: () => Promise.resolve(true) }),
}));

vi.mock('../../hooks/useThemeMode', () => ({ useThemeMode: () => 'light' }));

import { BookReader } from './BookReader';
import { parseBookmarksFromDoc } from '../../modules/docs/bookBookmarks';
import { t } from '../../i18n';

const NOTE_PATH = '/vault/Book.md';
const BOOKMARKS_LINE = /^bookmarks:.*$/m;

function button(label: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`no button ${label}`);
  return found;
}

function noteDoc(bookmarks?: unknown[]): string {
  const lines = ['---', 'type: book', 'pages: 1/2'];
  if (bookmarks) lines.push(`bookmarks: ${JSON.stringify(bookmarks)}`);
  lines.push('---', '', 'Body');
  return lines.join('\n');
}

describe('BookReader table of contents and bookmarks', () => {
  let renderer: MountedDom | null = null;

  beforeEach(() => {
    harness.doc = noteDoc();
    harness.relocate = null;
    harness.goTo = [];
    harness.goToToc = [];
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  async function openReader() {
    act(() => {
      renderer = mountDom(
        <BookReader
          workspacePath="/vault"
          bookFile="Files/b.epub"
          title="Book"
          progressPagePath={NOTE_PATH}
          onClose={() => {}}
        />,
      );
    });
    await actAndSettle();
    await actAndSettle();
  }

  async function openPanel() {
    await actAndSettle(() => button(t('reader.contents')).click());
  }

  it('shows the table of contents and navigates on click', async () => {
    await openReader();
    await openPanel();

    const items = [...document.querySelectorAll<HTMLElement>('.q-reader-toc-item')];
    expect(items.map((item) => item.textContent)).toEqual(['Chapter 1', 'Chapter 2']);

    await actAndSettle(() => items[1].click());
    expect(harness.goToToc).toEqual([9]);
    expect(document.querySelector('.q-reader-panel')).toBeNull();
  });

  it('highlights the chapter reported by relocate', async () => {
    await openReader();
    await openPanel();
    await actAndSettle(() => {
      harness.relocate?.({ cfi: 'epubcfi(/6/4!/4)', fraction: 0.5, tocId: 9 });
    });

    const active = document.querySelector('.q-reader-toc-item[aria-current="location"]');
    expect(active?.textContent).toBe('Chapter 2');
  });

  it('writes a bookmark of the current position into the note frontmatter', async () => {
    await openReader();
    await actAndSettle(() => {
      harness.relocate?.({ cfi: 'epubcfi(/6/4!/4)', fraction: 0.5, tocId: 7 });
    });
    await actAndSettle(() => button(t('reader.addBookmark')).click());

    const saved = parseBookmarksFromDoc(harness.doc);
    expect(saved).toHaveLength(1);
    expect(saved[0].cfi).toBe('epubcfi(/6/4!/4)');
    expect(saved[0].chapter).toBe('Chapter 1');
    expect(Number.isNaN(Date.parse(saved[0].createdAt))).toBe(false);
    expect(harness.doc.match(BOOKMARKS_LINE)).not.toBeNull();
  });

  it('reads stored bookmarks back, opens them and removes them', async () => {
    harness.doc = noteDoc([
      { cfi: 'epubcfi(/6/8!/2)', chapter: 'Chapter 2', createdAt: '2026-10-25T09:00:00.000Z' },
    ]);
    await openReader();
    await openPanel();

    const rows = [...document.querySelectorAll<HTMLElement>('.q-reader-bookmark-chapter')];
    expect(rows.map((row) => row.textContent)).toEqual(['Chapter 2']);

    await actAndSettle(() => document.querySelector<HTMLElement>('.q-reader-bookmark-open')!.click());
    expect(harness.goTo).toEqual(['epubcfi(/6/8!/2)']);

    await openPanel();
    await actAndSettle(() => button(t('reader.removeBookmark')).click());

    expect(parseBookmarksFromDoc(harness.doc)).toEqual([]);
    expect(harness.doc.match(BOOKMARKS_LINE)).toBeNull();
    expect(document.querySelector('.q-reader-bookmark')).toBeNull();
  });

  it('keeps a broken bookmark out of the list without failing', async () => {
    harness.doc = noteDoc([
      { cfi: 'not-a-cfi', chapter: 'Broken' },
      { cfi: 'epubcfi(/6/8!/2)', chapter: 'Chapter 2', createdAt: '2026-10-25T09:00:00.000Z' },
    ]);
    await openReader();
    await openPanel();

    const rows = [...document.querySelectorAll<HTMLElement>('.q-reader-bookmark-chapter')];
    expect(rows.map((row) => row.textContent)).toEqual(['Chapter 2']);
  });
});
