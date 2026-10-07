import { describe, expect, it } from 'vitest';
import { noteEmbedCreatesCycle, noteEmbedSection, parseNoteEmbed } from './noteEmbeds';

describe('note embeds', () => {
  it('parses note targets and heading references', () => {
    expect(parseNoteEmbed('![[Folder/Note#Heading|label]]')).toEqual({
      target: 'Folder/Note',
      heading: 'Heading',
    });
    expect(parseNoteEmbed('![[Note.md]]')).toEqual({ target: 'Note.md', heading: null });
  });

  it('leaves media embeds and inline text to the existing handlers', () => {
    expect(parseNoteEmbed('![[image.png]]')).toBeNull();
    expect(parseNoteEmbed('![[document.pdf]]')).toBeNull();
    expect(parseNoteEmbed('before ![[Note]] after')).toBeNull();
    expect(parseNoteEmbed('![[   ]]')).toBeNull();
    expect(parseNoteEmbed('![[Release.v2]]')).toEqual({ target: 'Release.v2', heading: null });
  });

  it('selects a heading and its children until the next peer heading', () => {
    expect(noteEmbedSection('# Intro\ntext\n## Plan\n- one\n### Detail\ntext\n## Next\nend', 'Plan'))
      .toBe('## Plan\n- one\n### Detail\ntext');
  });

  it('returns empty content when the requested heading is missing', () => {
    expect(noteEmbedSection('# Intro\ntext', 'Missing')).toBe('');
  });

  it('stops a cycle when an embedded path already appears in the ancestry', () => {
    expect(noteEmbedCreatesCycle('/vault/A.md', ['/vault/A.md', '/vault/B.md'])).toBe(true);
    expect(noteEmbedCreatesCycle('/vault/C.md', ['/vault/A.md', '/vault/B.md'])).toBe(false);
  });
});
