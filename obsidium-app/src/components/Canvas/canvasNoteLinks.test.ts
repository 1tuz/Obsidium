import { describe, expect, it } from 'vitest';
import { isNoteMarkdownPath, resolveNoteFragmentOffset, splitNoteLink } from './canvasNoteLinks';
import { resolveNotePath } from '../../modules/paths';

describe('canvas note links', () => {
  it('splits wiki targets into path and fragment while keeping aliases out', () => {
    expect(splitNoteLink('folder/Note#Heading', 'wiki')).toEqual({ target: 'folder/Note', fragment: 'Heading', source: 'wiki' });
    expect(splitNoteLink('Note#^block-1', 'wiki')).toEqual({ target: 'Note', fragment: '^block-1', source: 'wiki' });
    expect(splitNoteLink('Note', 'wiki')).toEqual({ target: 'Note', fragment: '', source: 'wiki' });
    expect(splitNoteLink('Notes/My%20Plan.md#Part%20two', 'markdown')).toEqual({
      target: 'Notes/My%20Plan.md', fragment: 'Part two', source: 'markdown',
    });
  });

  it('rejects external and unsafe schemes and protocol-relative targets', () => {
    expect(splitNoteLink('https://example.test', 'markdown')).toBeNull();
    expect(splitNoteLink('javascript:alert(1)', 'markdown')).toBeNull();
    expect(splitNoteLink('data:text/html,hi', 'markdown')).toBeNull();
    expect(splitNoteLink('//example.test/note', 'markdown')).toBeNull();
  });

  it('accepts only .md markdown paths including encoded names', () => {
    expect(isNoteMarkdownPath('Notes/Plan.md')).toBe(true);
    expect(isNoteMarkdownPath('Notes/Plan.md#heading')).toBe(true);
    expect(isNoteMarkdownPath('Notes/My%20Plan.md')).toBe(true);
    expect(isNoteMarkdownPath('image.png')).toBe(false);
    expect(isNoteMarkdownPath('Notes/Plan')).toBe(false);
  });

  it('finds heading and block offsets in source text', () => {
    const source = '# Top\n\nbody\n\n## Part two\n\nline ^block-1\n';
    expect(resolveNoteFragmentOffset(source, 'Part two')).toBe(13);
    expect(resolveNoteFragmentOffset(source, '^block-1')).toBe(31);
    expect(resolveNoteFragmentOffset(source, '')).toBe(0);
    expect(resolveNoteFragmentOffset(source, 'Missing')).toBeNull();
  });

  it('keeps original offsets with CRLF, fenced code and exact block ids', () => {
    const crlf = '# Top\r\n\r\n## Target\r\n';
    expect(resolveNoteFragmentOffset(crlf, 'Target')).toBe(7);
    const fenced = '```md\n## Target\n```\n\n## Target\n';
    expect(resolveNoteFragmentOffset(fenced, 'Target')).toBe(fenced.lastIndexOf('## Target'));
    const blocks = 'first ^block-more\n\nsecond ^block\n';
    expect(blocks.lastIndexOf('^block')).toBe(26);
    expect([...blocks.matchAll(/\^block/g)].map((m) => m.index)).toEqual([6, 26]);
    expect(resolveNoteFragmentOffset(blocks, '^block-more')).toBe(6);
    expect(resolveNoteFragmentOffset(blocks, '^block')).toBe(26);
    expect(resolveNoteFragmentOffset(fenced, '^block')).toBeNull();
  });

  it('resolves markdown paths relative to the source note inside the workspace', () => {
    expect(resolveNotePath('/vault', '/vault/Notes', 'Other.md')).toEqual({
      relative: 'Notes/Other.md', absolute: '/vault/Notes/Other.md',
    });
    expect(resolveNotePath('/vault', '/vault/Notes', '../Boards/Plan.md#part')).toEqual({
      relative: 'Boards/Plan.md', absolute: '/vault/Boards/Plan.md',
    });
    expect(resolveNotePath('/vault', '/vault/Notes', '/Root.md')).toEqual({
      relative: 'Root.md', absolute: '/vault/Root.md',
    });
    expect(resolveNotePath('/vault', '/vault', '../../escape.md')).toBeNull();
    expect(resolveNotePath('/vault', '/vault', 'image.png')).toBeNull();
  });
});
