import { describe, expect, it } from 'vitest';
import { resolveFragmentOffset, splitLinkTarget } from './fragment';

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

  it('resolves heading and block offsets', () => {
    const source = '# Top\n\nbody\n\n## Part two\n\nline ^block-1\n';
    expect(resolveFragmentOffset(source, 'Part two')).toBe(13);
    expect(resolveFragmentOffset(source, '^block-1')).toBe(31);
    expect(resolveFragmentOffset(source, 'Missing')).toBeNull();
  });

  it('opens the top for an empty fragment', () => {
    expect(resolveFragmentOffset('# Top\n\nbody\n', '')).toBe(0);
    expect(resolveFragmentOffset('# Top\n\nbody\n', '  ')).toBe(0);
  });

  it('keeps original offsets with CRLF, fenced code and exact block ids', () => {
    const crlf = '# Top\r\n\r\n## Target\r\n';
    expect(resolveFragmentOffset(crlf, 'Target')).toBe(7);
    const fenced = '```md\n## Target\n```\n\n## Target\n';
    expect(resolveFragmentOffset(fenced, 'Target')).toBe(fenced.lastIndexOf('## Target'));
    const blocks = 'first ^block-more\n\nsecond ^block\n';
    expect(resolveFragmentOffset(blocks, '^block-more')).toBe(6);
    expect(resolveFragmentOffset(blocks, '^block')).toBe(26);
    expect(resolveFragmentOffset(fenced, '^block')).toBeNull();
  });
});
