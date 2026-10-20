import { describe, expect, it } from 'vitest';
import { canvasMediaKind, resolveCanvasMedia } from './media';

const vault = '/vault';

describe('canvasMediaKind', () => {
  it('recognizes image and video extensions case-insensitively', () => {
    expect(canvasMediaKind('a.PNG')).toBe('image');
    expect(canvasMediaKind('a.svg')).toBe('image');
    expect(canvasMediaKind('a.jpeg')).toBe('image');
    expect(canvasMediaKind('clip.MP4')).toBe('video');
    expect(canvasMediaKind('clip.mkv')).toBe('video');
  });

  it('ignores query strings and fragments', () => {
    expect(canvasMediaKind('https://x/y.png?raw=1#top')).toBe('image');
  });

  it('maps data URLs by media type', () => {
    expect(canvasMediaKind('data:image/png;base64,AAAA')).toBe('image');
    expect(canvasMediaKind('data:video/mp4;base64,AAAA')).toBe('video');
    expect(canvasMediaKind('data:text/plain,hello')).toBeNull();
  });

  it('returns null for non-media targets', () => {
    expect(canvasMediaKind('Notes/Plan.md')).toBeNull();
    expect(canvasMediaKind('no-extension')).toBeNull();
  });
});

describe('resolveCanvasMedia', () => {
  it('resolves an own file node against the workspace root', () => {
    expect(
      resolveCanvasMedia({
        workspacePath: vault,
        canvasPath: 'Boards/B.canvas',
        nodeType: 'file',
        nodeFile: 'Files/a.png',
        target: 'Files/a.png',
      }),
    ).toEqual({ kind: 'image', url: '/vault/Files/a.png', external: false });
  });

  it('resolves relative media inside a markdown note', () => {
    expect(
      resolveCanvasMedia({
        workspacePath: vault,
        canvasPath: 'Boards/B.canvas',
        nodeType: 'file',
        nodeFile: 'Notes/Plan.md',
        target: 'diagram.png',
      }),
    ).toEqual({ kind: 'image', url: '/vault/Notes/diagram.png', external: false });
  });

  it('resolves text card media relative to the canvas', () => {
    expect(
      resolveCanvasMedia({
        workspacePath: vault,
        canvasPath: 'Boards/B.canvas',
        nodeType: 'text',
        target: 'img.png',
      }),
    ).toEqual({ kind: 'image', url: '/vault/Boards/img.png', external: false });
  });

  it('resolves link card media relative to the canvas directory', () => {
    expect(
      resolveCanvasMedia({
        workspacePath: vault,
        canvasPath: 'Boards/B.canvas',
        nodeType: 'link',
        target: 'pics/x.webp',
      }),
    ).toEqual({ kind: 'image', url: '/vault/Boards/pics/x.webp', external: false });
  });

  it('keeps remote URLs external and unchanged', () => {
    expect(
      resolveCanvasMedia({
        workspacePath: vault,
        canvasPath: 'Boards/B.canvas',
        nodeType: 'link',
        target: 'https://x/y.png',
      }),
    ).toEqual({ kind: 'image', url: 'https://x/y.png', external: true });
  });

  it('keeps data URLs external and typed', () => {
    expect(
      resolveCanvasMedia({
        workspacePath: vault,
        canvasPath: 'Boards/B.canvas',
        nodeType: 'text',
        target: 'data:image/png;base64,AAAA',
      }),
    ).toEqual({ kind: 'image', url: 'data:image/png;base64,AAAA', external: true });
  });

  it('rejects traversal beyond the workspace', () => {
    expect(
      resolveCanvasMedia({
        workspacePath: vault,
        canvasPath: 'Boards/B.canvas',
        nodeType: 'text',
        target: '../../etc/passwd.png',
      }),
    ).toBeNull();
  });

  it('percent-decodes file names once', () => {
    expect(
      resolveCanvasMedia({
        workspacePath: vault,
        canvasPath: 'Boards/B.canvas',
        nodeType: 'file',
        nodeFile: '2026-08-09 08-08-49.mp4',
        target: 'Files/2026-08-09%2008-08-49.mp4',
      }),
    ).toEqual({ kind: 'video', url: '/vault/Files/2026-08-09 08-08-49.mp4', external: false });
  });

  it('returns null for non-media targets', () => {
    expect(
      resolveCanvasMedia({
        workspacePath: vault,
        canvasPath: 'Boards/B.canvas',
        nodeType: 'file',
        nodeFile: 'Notes/Plan.md',
        target: 'Notes/Plan.md',
      }),
    ).toBeNull();
  });
});
