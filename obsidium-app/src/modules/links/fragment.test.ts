import { describe, expect, it } from 'vitest';
import { FragmentKind, parseFragment, resolveFragmentOffset, splitLinkTarget } from './fragment';

describe('link fragments', () => {
  it('splits a target into path and fragment', () => {
    expect(splitLinkTarget('Note#H')).toEqual({ target: 'Note', fragment: 'H' });
    expect(splitLinkTarget('Note#^block-1')).toEqual({ target: 'Note', fragment: '^block-1' });
    expect(splitLinkTarget('Note')).toEqual({ target: 'Note', fragment: '' });
    expect(splitLinkTarget('Note#')).toEqual({ target: 'Note', fragment: '' });
    expect(splitLinkTarget('  folder/Note#Part two  ')).toEqual({ target: 'folder/Note', fragment: 'Part two' });
  });

  it('keeps an empty target for heading-only links', () => {
    expect(splitLinkTarget('#H')).toEqual({ target: '', fragment: 'H' });
    expect(splitLinkTarget('#')).toEqual({ target: '', fragment: '' });
  });

  it('strips angle brackets and decodes the fragment', () => {
    expect(splitLinkTarget('<Note#H>')).toEqual({ target: 'Note', fragment: 'H' });
    expect(splitLinkTarget('Note#%D0%92%D0%B2%D0%B5%D0%B4%D0%B5%D0%BD%D0%B8%D0%B5'))
      .toEqual({ target: 'Note', fragment: 'Введение' });
    expect(splitLinkTarget('Note#100%')).toEqual({ target: 'Note', fragment: '100%' });
  });

  it('rejects empty input', () => {
    expect(splitLinkTarget('')).toBeNull();
    expect(splitLinkTarget('   ')).toBeNull();
  });

  it('reads the fragment kind and value', () => {
    expect(parseFragment('#^block-1')).toEqual({ kind: FragmentKind.Block, value: 'block-1' });
    expect(parseFragment('^block-1')).toEqual({ kind: FragmentKind.Block, value: 'block-1' });
    expect(parseFragment('#Part two')).toEqual({ kind: FragmentKind.Heading, value: 'Part two' });
    expect(parseFragment('Part two')).toEqual({ kind: FragmentKind.Heading, value: 'Part two' });
    expect(parseFragment('^')).toBeNull();
    expect(parseFragment('^bad_id')).toBeNull();
    expect(parseFragment('   ')).toBeNull();
  });

  it('resolves heading and block offsets', () => {
    const source = '# Top\n\nbody\n\n## Part two\n\nline ^block-1\n';
    expect(resolveFragmentOffset(source, 'Part two')).toBe(13);
    expect(resolveFragmentOffset(source, '^block-1')).toBe(26);
    expect(resolveFragmentOffset(source, '#^block-1')).toBe(26);
    expect(resolveFragmentOffset(source, 'Missing')).toBeNull();
    expect(resolveFragmentOffset(source, '^missing')).toBeNull();
  });

  it('opens the top for an empty fragment', () => {
    expect(resolveFragmentOffset('# Top\n\nbody\n', '')).toBe(0);
    expect(resolveFragmentOffset('# Top\n\nbody\n', '  ')).toBe(0);
  });

  it('resolves a block to the first line of its paragraph', () => {
    const source = 'Первый абзац\nвторая строка ^risks\n';
    expect(resolveFragmentOffset(source, '^risks')).toBe(0);
  });

  it('treats a list item as its own block', () => {
    const source = '- один\n- два ^item\n- три\n';
    expect(resolveFragmentOffset(source, '^item')).toBe(source.indexOf('- два'));
  });

  it('resolves CRLF text, fenced code and exact block ids', () => {
    const crlf = '# Top\r\n\r\n## Target\r\n';
    expect(resolveFragmentOffset(crlf, 'Target')).toBe(7);
    const fenced = '```md\n## Target\n```\n\n## Target\n';
    expect(resolveFragmentOffset(fenced, 'Target')).toBe(fenced.lastIndexOf('## Target'));
    const blocks = 'first ^block-more\n\nsecond ^block\n';
    expect(resolveFragmentOffset(blocks, '^block-more')).toBe(0);
    expect(resolveFragmentOffset(blocks, '^block')).toBe(blocks.indexOf('second'));
    expect(resolveFragmentOffset(fenced, '^block')).toBeNull();
  });

  it('ignores block ids inside code and headings', () => {
    const inline = 'Текст `незакрытый ^inline\n\nРеальный ^real\n';
    expect(resolveFragmentOffset(inline, '^inline')).toBeNull();
    expect(resolveFragmentOffset(inline, '^real')).toBe(inline.indexOf('Реальный'));
    const fenced = '```\nтекст ^fenced\n```\n';
    expect(resolveFragmentOffset(fenced, '^fenced')).toBeNull();
    const heading = '## Раздел ^heading\n';
    expect(resolveFragmentOffset(heading, '^heading')).toBeNull();
  });

  it('ignores a marker in the middle of a paragraph', () => {
    expect(resolveFragmentOffset('начало ^mid\nпродолжение\n', '^mid')).toBeNull();
  });

  it('treats a heading as a block boundary', () => {
    const after = '## Раздел\nтекст ^after\n';
    expect(resolveFragmentOffset(after, '^after')).toBe(after.indexOf('текст'));
    const before = 'текст ^before\n## Раздел\n';
    expect(resolveFragmentOffset(before, '^before')).toBe(0);
  });
});
