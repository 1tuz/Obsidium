import { describe, expect, it } from 'vitest';
import { fileIcon, rebaseFileIcons, setFileIcon } from './iconize';

describe('Iconize file assignments', () => {
  it('preserves other paths when assigning or removing an icon', () => {
    const a = setFileIcon({}, '/vault/a.md', { name: 'star', color: '#ff0000' });
    const b = setFileIcon(a, '/vault/b', { name: 'folder', color: '#abcdef' });
    expect(a['/vault/a.md'].name).toBe('star');
    expect(Object.keys(setFileIcon(b, '/vault/a.md', null))).toEqual(['/vault/b']);
  });
  it('moves nested icon assignments when a folder is renamed', () => {
    const state = { '/vault/work/note.md': { name: 'book' as const, color: '#123456' } };
    expect(rebaseFileIcons(state, '/vault/work', '/vault/archive'))
      .toEqual({ '/vault/archive/note.md': state['/vault/work/note.md'] });
  });
  it('rejects unknown icon names and unsafe CSS colors', () => {
    expect(setFileIcon({}, 'bad', { name: 'star', color: 'url(javascript:alert(1))' })).toEqual({});
    expect(fileIcon('unrecognized')).toBeTruthy();
  });
});
