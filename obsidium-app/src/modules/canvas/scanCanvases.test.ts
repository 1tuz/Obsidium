import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceItem } from '../documents/fileGateway';
import { scanCanvases } from './scanCanvases';

const directories: Record<string, WorkspaceItem[]> = {
  '/vault': [
    { id: '/vault/Boards.canvas', name: 'Boards.canvas', type: 'file' },
    { id: '/vault/Note.md', name: 'Note.md', type: 'file' },
    { id: '/vault/Work', name: 'Work', type: 'folder' },
    { id: '/vault/Empty', name: 'Empty', type: 'folder' },
  ],
  '/vault/Work': [
    { id: '/vault/Work/Map.Canvas', name: 'Map.Canvas', type: 'file' },
    { id: '/vault/Work/Plan.base', name: 'Plan.base', type: 'file' },
    { id: '/vault/Work/Deep', name: 'Deep', type: 'folder' },
  ],
  '/vault/Work/Deep': [
    { id: '/vault/Work/Deep/Sketch.canvas', name: 'Sketch.canvas', type: 'file' },
  ],
  '/vault/Empty': [],
};

const readDirectory = async (path: string): Promise<WorkspaceItem[]> => directories[path] ?? [];

describe('scanCanvases', () => {
  it('walks folders recursively and returns only canvas documents with their folder', async () => {
    const canvases = await scanCanvases('/vault', readDirectory);

    expect(canvases).toEqual([
      { path: '/vault/Boards.canvas', name: 'Boards', folder: '' },
      { path: '/vault/Work/Deep/Sketch.canvas', name: 'Sketch', folder: 'Work/Deep' },
      { path: '/vault/Work/Map.Canvas', name: 'Map', folder: 'Work' },
    ]);
  });

  it('stops walking as soon as the caller cancels the scan', async () => {
    let cancelled = false;
    const read = vi.fn(async (path: string) => {
      if (path === '/vault/Work') cancelled = true;
      return directories[path] ?? [];
    });

    const canvases = await scanCanvases('/vault', read, () => cancelled);

    expect(canvases.map((canvas) => canvas.path)).toEqual(['/vault/Boards.canvas']);
    expect(read).not.toHaveBeenCalledWith('/vault/Work/Deep');
  });

  it('returns nothing for an empty workspace', async () => {
    await expect(scanCanvases('/nowhere', readDirectory)).resolves.toEqual([]);
  });
});
