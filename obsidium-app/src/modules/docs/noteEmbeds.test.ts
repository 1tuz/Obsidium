import { describe, expect, it } from 'vitest';
import { noteEmbedCreatesCycle, noteEmbedSection, parseNoteEmbed } from './noteEmbeds';

describe('note embeds', () => {
  it('parses note targets and heading references', () => {
    expect(parseNoteEmbed('![[Folder/Note#Heading|label]]')).toEqual({
      target: 'Folder/Note',
      heading: 'Heading',
      blockId: null,
    });
    expect(parseNoteEmbed('![[Note.md]]')).toEqual({ target: 'Note.md', heading: null, blockId: null });
    expect(parseNoteEmbed('![[Note#^block-id]]')).toEqual({
      target: 'Note',
      heading: null,
      blockId: 'block-id',
    });
  });

  it('leaves media embeds and inline text to the existing handlers', () => {
    expect(parseNoteEmbed('![[image.png]]')).toBeNull();
    expect(parseNoteEmbed('![[document.pdf]]')).toBeNull();
    expect(parseNoteEmbed('before ![[Note]] after')).toBeNull();
    expect(parseNoteEmbed('![[   ]]')).toBeNull();
    expect(parseNoteEmbed('![[Release.v2]]')).toEqual({ target: 'Release.v2', heading: null, blockId: null });
  });

  it('selects a heading and its children until the next peer heading', () => {
    expect(noteEmbedSection('# Intro\ntext\n## Plan\n- one\n### Detail\ntext\n## Next\nend', 'Plan'))
      .toBe('## Plan\n- one\n### Detail\ntext');
  });

  it('returns empty content when the requested heading is missing', () => {
    expect(noteEmbedSection('# Intro\ntext', 'Missing')).toBe('');
  });

  it('selects a paragraph or list item by block identifier', () => {
    expect(noteEmbedSection('Before\n\nParagraph text ^paragraph-id\n\nAfter', null, 'paragraph-id'))
      .toBe('Paragraph text');
    expect(noteEmbedSection('- first\n- second ^list-id\n- third', null, 'list-id'))
      .toBe('- second');
  });

  it('does not match block identifiers inside fenced code', () => {
    expect(noteEmbedSection('```md\nText ^block-id\n```\n\nReal text ^other-id', null, 'block-id'))
      .toBe('');
  });

  it('stops a cycle when an embedded path already appears in the ancestry', () => {
    expect(noteEmbedCreatesCycle('/vault/A.md', ['/vault/A.md', '/vault/B.md'])).toBe(true);
    expect(noteEmbedCreatesCycle('/vault/C.md', ['/vault/A.md', '/vault/B.md'])).toBe(false);
  });
});
