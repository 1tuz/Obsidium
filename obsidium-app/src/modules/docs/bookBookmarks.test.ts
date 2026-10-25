import { describe, expect, it } from 'vitest';
import {
  addBookmarkToDoc,
  isBookmarkCfi,
  parseBookmarks,
  parseBookmarksFromDoc,
  removeBookmarkFromDoc,
  serializeBookmarks,
  withBookmark,
  withoutBookmark,
} from './bookBookmarks';
import type { BookBookmark } from './bookBookmarks';
import { FM_BOOKMARKS } from './frontmatter';

const BOOK_DOC = '---\ntype: book\ntitle: Дюна\n---\nBody\n';

const first: BookBookmark = {
  cfi: 'epubcfi(/6/4!/4)',
  chapter: 'Глава 1',
  createdAt: '2026-10-25T09:00:00.000Z',
};

const second: BookBookmark = {
  cfi: 'epubcfi(/6/8!/2)',
  chapter: 'Глава 2',
  note: 'Мысль',
  createdAt: '2026-10-25T10:00:00.000Z',
};

function applied(doc: string | null): string {
  if (doc === null) throw new Error('expected a document with frontmatter');
  return doc;
}

describe('isBookmarkCfi', () => {
  it('accepts epub CFI strings only', () => {
    expect(isBookmarkCfi('epubcfi(/6/4!/4)')).toBe(true);
    expect(isBookmarkCfi('epubcfi()')).toBe(true);
    expect(isBookmarkCfi('cfi(/6/4!/4)')).toBe(false);
    expect(isBookmarkCfi('epubcfi(/6/4!/4')).toBe(false);
    expect(isBookmarkCfi(42)).toBe(false);
    expect(isBookmarkCfi(null)).toBe(false);
    expect(isBookmarkCfi(`epubcfi(${'a'.repeat(2048)})`)).toBe(false);
  });
});

describe('parseBookmarks', () => {
  it('returns an empty list without metadata', () => {
    expect(parseBookmarks(null)).toEqual([]);
    expect(parseBookmarks(undefined)).toEqual([]);
    expect(parseBookmarks({})).toEqual([]);
  });

  it('trims fields, drops empty notes and keeps order', () => {
    const doc = [
      '---',
      `${FM_BOOKMARKS}: [{"cfi":"epubcfi(/6/4!/4)","chapter":" Глава 1 ","note":"  ","createdAt":"2026-10-25T09:00:00.000Z"},{"cfi":"epubcfi(/6/8!/2)","chapter":"Глава 2","note":" Мысль ","createdAt":7}]`,
      '---',
      'Body',
    ].join('\n');

    expect(parseBookmarksFromDoc(doc)).toEqual([
      { cfi: 'epubcfi(/6/4!/4)', chapter: 'Глава 1', createdAt: '2026-10-25T09:00:00.000Z' },
      { cfi: 'epubcfi(/6/8!/2)', chapter: 'Глава 2', note: 'Мысль', createdAt: '' },
    ]);
  });

  it('keeps the first entry per cfi', () => {
    const data = {
      [FM_BOOKMARKS]:
        '[{"cfi":"epubcfi(/6/4!/4)","chapter":"Первая"},{"cfi":"epubcfi(/6/4!/4)","chapter":"Вторая"}]',
    };
    expect(parseBookmarks(data)).toEqual([
      { cfi: 'epubcfi(/6/4!/4)', chapter: 'Первая', createdAt: '' },
    ]);
  });

  it('drops garbage entries without throwing', () => {
    const doc = [
      '---',
      `${FM_BOOKMARKS}: [{"cfi":"epubcfi(/6/4!/4)","chapter":"Глава 1","createdAt":"2026-10-25T09:00:00.000Z"},{"cfi":"broken","chapter":"Bad"},{"chapter":"No cfi"},42,"junk",{"cfi":"epubcfi(/6/6!/2)"}]`,
      '---',
      'Body',
    ].join('\n');

    expect(parseBookmarksFromDoc(doc)).toEqual([
      { cfi: 'epubcfi(/6/4!/4)', chapter: 'Глава 1', createdAt: '2026-10-25T09:00:00.000Z' },
      { cfi: 'epubcfi(/6/6!/2)', chapter: '', createdAt: '' },
    ]);
  });

  it('tolerates values that are not a JSON array', () => {
    expect(parseBookmarksFromDoc('---\nbookmarks: [a, b]\n---\nBody')).toEqual([]);
    expect(parseBookmarksFromDoc('---\nbookmarks: [{oops}]\n---\nBody')).toEqual([]);
    expect(parseBookmarksFromDoc('---\nbookmarks: {"cfi":"epubcfi(/6/4!/4)"}\n---\nBody')).toEqual([]);
    expect(parseBookmarksFromDoc('---\nbookmarks:\n---\nBody')).toEqual([]);
  });

  it('returns an empty list without frontmatter', () => {
    expect(parseBookmarksFromDoc('Body only')).toEqual([]);
  });
});

describe('serializeBookmarks', () => {
  it('returns an empty string for an empty list', () => {
    expect(serializeBookmarks([])).toBe('');
  });

  it('writes a YAML flow sequence and omits empty notes', () => {
    expect(serializeBookmarks([first])).toBe(
      '[{"cfi":"epubcfi(/6/4!/4)","chapter":"Глава 1","createdAt":"2026-10-25T09:00:00.000Z"}]',
    );
    expect(serializeBookmarks([{ ...first, note: '   ' }])).not.toContain('note');
    expect(serializeBookmarks([second])).toContain('"note":"Мысль"');
  });
});

describe('withBookmark and withoutBookmark', () => {
  it('puts the newest first and replaces the same cfi', () => {
    expect(withBookmark([first], second)).toEqual([second, first]);
    const updated = { ...first, chapter: 'Глава 1 (правка)' };
    expect(withBookmark([second, first], updated)).toEqual([updated, second]);
  });

  it('removes by cfi', () => {
    expect(withoutBookmark([second, first], first.cfi)).toEqual([second]);
    expect(withoutBookmark([first], second.cfi)).toEqual([first]);
  });
});

describe('document round trip', () => {
  it('adds bookmarks and parses the same fields and order back', () => {
    const withFirst = applied(addBookmarkToDoc(BOOK_DOC, first));
    const withSecond = applied(addBookmarkToDoc(withFirst, second));

    expect(parseBookmarksFromDoc(withSecond)).toEqual([second, first]);
    expect(withSecond).toContain(
      `${FM_BOOKMARKS}: [{"cfi":"epubcfi(/6/8!/2)","chapter":"Глава 2","note":"Мысль","createdAt":"2026-10-25T10:00:00.000Z"},{"cfi":"epubcfi(/6/4!/4)","chapter":"Глава 1","createdAt":"2026-10-25T09:00:00.000Z"}]`,
    );
    expect(withSecond).toContain('type: book');
    expect(withSecond).toContain('Body');
  });

  it('replaces an existing bookmark with the same cfi', () => {
    const doc = applied(addBookmarkToDoc(applied(addBookmarkToDoc(BOOK_DOC, first)), second));
    const updated = { ...first, chapter: 'Глава 1 (правка)' };
    const next = applied(addBookmarkToDoc(doc, updated));

    expect(parseBookmarksFromDoc(next)).toEqual([updated, second]);
    expect(next.match(new RegExp(`^${FM_BOOKMARKS}:`, 'gm'))).toHaveLength(1);
  });

  it('removes one bookmark and keeps the rest', () => {
    const doc = applied(addBookmarkToDoc(applied(addBookmarkToDoc(BOOK_DOC, first)), second));
    const next = applied(removeBookmarkFromDoc(doc, second.cfi));

    expect(parseBookmarksFromDoc(next)).toEqual([first]);
    expect(next).toContain('type: book');
  });

  it('drops the frontmatter line when the last bookmark is removed', () => {
    const doc = applied(addBookmarkToDoc(BOOK_DOC, first));
    const next = applied(removeBookmarkFromDoc(doc, first.cfi));

    expect(next).not.toContain(FM_BOOKMARKS);
    expect(next).toBe(BOOK_DOC);
    expect(parseBookmarksFromDoc(next)).toEqual([]);
  });

  it('returns null when the document has no frontmatter', () => {
    expect(addBookmarkToDoc('Body only', first)).toBeNull();
    expect(removeBookmarkFromDoc('Body only', first.cfi)).toBeNull();
  });
});
