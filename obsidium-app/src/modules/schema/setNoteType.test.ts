import { describe, expect, it } from 'vitest';
import { setNoteType } from './setNoteType';

describe('setNoteType', () => {
  it('adds the type to an existing frontmatter', () => {
    const next = setNoteType('---\ntitle: Dune\n---\nBody', 'Book');
    expect(next).toBe('---\ntitle: Dune\ntype: Book\n---\nBody');
  });

  it('replaces the declared type', () => {
    expect(setNoteType('---\ntype: Book\n---\nBody', 'Person')).toBe('---\ntype: Person\n---\nBody');
  });

  it('prepends a frontmatter block when the note has none', () => {
    expect(setNoteType('Body\n', 'Book')).toBe('---\ntype: Book\n---\nBody\n');
  });

  it('keeps CRLF line endings when prepending a block', () => {
    expect(setNoteType('Body\r\n', 'Book')).toBe('---\r\ntype: Book\r\n---\r\nBody\r\n');
  });

  it('keeps CRLF line endings when editing an existing block', () => {
    expect(setNoteType('---\r\ntitle: Dune\r\n---\r\nBody', 'Book'))
      .toBe('---\r\ntitle: Dune\r\ntype: Book\r\n---\r\nBody');
  });

  it('removes the type and leaves the rest of the block intact', () => {
    expect(setNoteType('---\ntitle: Dune\ntype: Book\n---\nBody', null))
      .toBe('---\ntitle: Dune\n---\nBody');
  });

  it('drops the block-less note back to plain content when removing a missing type', () => {
    expect(setNoteType('Body', null)).toBeNull();
  });

  it('does nothing when the type is already set', () => {
    expect(setNoteType('---\ntype: Book\n---\nBody', 'Book')).toBeNull();
    expect(setNoteType('---\ntype: book\n---\nBody', 'Book')).toBeNull();
  });

  it('does nothing when removing from a note without a type key', () => {
    expect(setNoteType('---\ntitle: Dune\n---\nBody', null)).toBeNull();
  });

  it('replaces a multi-type declaration with a single type', () => {
    expect(setNoteType('---\ntype: [Book, Entry]\n---\nBody', 'Person'))
      .toBe('---\ntype: Person\n---\nBody');
    expect(setNoteType('---\ntype: [Book, Entry]\n---\nBody', 'Book'))
      .toBe('---\ntype: Book\n---\nBody');
  });

  it('keeps the original spelling of the type key', () => {
    expect(setNoteType('---\nType: Book\n---\nBody', 'Person')).toBe('---\nType: Person\n---\nBody');
    expect(setNoteType('---\nType: Book\n---\nBody', null)).toBe('---\n\n---\nBody');
  });
});
