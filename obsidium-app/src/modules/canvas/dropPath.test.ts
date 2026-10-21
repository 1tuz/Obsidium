import { describe, expect, it } from 'vitest';
import { canvasWorkspacePath } from './dropPath';

const root = '/vault';

describe('canvasWorkspacePath', () => {
  it('turns an absolute path inside the workspace into a relative one', () => {
    expect(canvasWorkspacePath(root, '/vault/Notes/Plan.md')).toBe('Notes/Plan.md');
  });

  it('keeps a path that is already relative', () => {
    expect(canvasWorkspacePath(root, 'Notes/Plan.md')).toBe('Notes/Plan.md');
    expect(canvasWorkspacePath(root, './Notes/Plan.md')).toBe('Notes/Plan.md');
  });

  it('reads the first entry of a uri list and strips the file scheme', () => {
    expect(canvasWorkspacePath(root, '# comment\nfile:///vault/Notes/Plan.md\n')).toBe('Notes/Plan.md');
    expect(canvasWorkspacePath(root, 'https://example.com/image.png')).toBe('https://example.com/image.png');
  });

  it('rejects paths outside the workspace and paths that climb out of it', () => {
    expect(canvasWorkspacePath(root, '/elsewhere/Plan.md')).toBeNull();
    expect(canvasWorkspacePath(root, '../Plan.md')).toBeNull();
    expect(canvasWorkspacePath(root, '   ')).toBeNull();
  });

  it('accepts windows absolute paths', () => {
    expect(canvasWorkspacePath('C:\\vault', 'C:\\vault\\Notes\\Plan.md')).toBe('Notes/Plan.md');
  });
});
