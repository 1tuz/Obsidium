// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { mediaFilesOf } from './paste';

describe('mediaFilesOf', () => {
  it('accepts images whose clipboard entry has no MIME type but a media name', () => {
    const files = [
      new File([new Uint8Array([1])], 'Screenshot.png', { type: '' }),
      new File([new Uint8Array([1])], 'clip.mp4', { type: '' }),
    ] as unknown as FileList;

    expect(mediaFilesOf({ files } as DataTransfer).map((file) => file.name)).toEqual([
      'Screenshot.png',
      'clip.mp4',
    ]);
  });

  it('ignores files that are neither image nor video', () => {
    const files = [
      new File([new Uint8Array([1])], 'notes.md', { type: 'text/markdown' }),
      new File([new Uint8Array([1])], 'photo.webp', { type: 'image/webp' }),
    ] as unknown as FileList;

    expect(mediaFilesOf({ files } as DataTransfer).map((file) => file.name)).toEqual(['photo.webp']);
  });

  it('treats a paste without a file list as empty instead of throwing', () => {
    expect(mediaFilesOf(null)).toEqual([]);
    expect(mediaFilesOf({} as DataTransfer)).toEqual([]);
    expect(mediaFilesOf(undefined)).toEqual([]);
  });
});
