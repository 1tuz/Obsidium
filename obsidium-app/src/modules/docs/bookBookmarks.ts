import { FM_BOOKMARKS, parseFrontmatter, setFrontmatterField } from './frontmatter';
import type { BookMetadata } from './frontmatter';

export type BookBookmark = {
  cfi: string;
  chapter: string;
  note?: string;
  createdAt: string;
};

const MAX_CFI_LENGTH = 2048;

export function isBookmarkCfi(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_CFI_LENGTH &&
    value.startsWith('epubcfi(') &&
    value.endsWith(')')
  );
}

function toBookmark(entry: unknown): BookBookmark | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
  const { cfi, chapter, note, createdAt } = entry as Record<string, unknown>;
  if (!isBookmarkCfi(cfi)) return null;
  const bookmark: BookBookmark = {
    cfi,
    chapter: typeof chapter === 'string' ? chapter.trim() : '',
    createdAt: typeof createdAt === 'string' ? createdAt : '',
  };
  if (typeof note === 'string' && note.trim()) bookmark.note = note.trim();
  return bookmark;
}

export function parseBookmarks(data: BookMetadata | null | undefined): BookBookmark[] {
  const raw = data?.[FM_BOOKMARKS];
  if (typeof raw !== 'string' || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const bookmarks: BookBookmark[] = [];
  for (const entry of parsed) {
    const bookmark = toBookmark(entry);
    if (!bookmark || seen.has(bookmark.cfi)) continue;
    seen.add(bookmark.cfi);
    bookmarks.push(bookmark);
  }
  return bookmarks;
}

export function parseBookmarksFromDoc(doc: string): BookBookmark[] {
  return parseBookmarks(parseFrontmatter(doc)?.data);
}

function toStoredBookmark(bookmark: BookBookmark): BookBookmark {
  const note = bookmark.note?.trim();
  return note
    ? { cfi: bookmark.cfi, chapter: bookmark.chapter, note, createdAt: bookmark.createdAt }
    : { cfi: bookmark.cfi, chapter: bookmark.chapter, createdAt: bookmark.createdAt };
}

export function serializeBookmarks(list: readonly BookBookmark[]): string {
  if (list.length === 0) return '';
  return JSON.stringify(list.map(toStoredBookmark));
}

export function withBookmark(list: readonly BookBookmark[], bookmark: BookBookmark): BookBookmark[] {
  return [bookmark, ...list.filter(item => item.cfi !== bookmark.cfi)];
}

export function withoutBookmark(list: readonly BookBookmark[], cfi: string): BookBookmark[] {
  return list.filter(item => item.cfi !== cfi);
}

export function addBookmarkToDoc(doc: string, bookmark: BookBookmark): string | null {
  const next = withBookmark(parseBookmarksFromDoc(doc), bookmark);
  return setFrontmatterField(doc, FM_BOOKMARKS, serializeBookmarks(next));
}

export function removeBookmarkFromDoc(doc: string, cfi: string): string | null {
  const next = withoutBookmark(parseBookmarksFromDoc(doc), cfi);
  return setFrontmatterField(doc, FM_BOOKMARKS, serializeBookmarks(next));
}
