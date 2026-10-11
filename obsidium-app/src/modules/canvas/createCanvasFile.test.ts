import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAtFreeName, createFile } = vi.hoisted(() => ({
  createAtFreeName: vi.fn(),
  createFile: vi.fn(),
}));

vi.mock('../documents/fileGateway', () => ({ createAtFreeName, createFile }));

import { createCanvasFile } from './createCanvasFile';

describe('createCanvasFile', () => {
  beforeEach(() => {
    createAtFreeName.mockReset();
    createFile.mockReset();
  });

  it('creates an empty JSON Canvas document with a collision-safe name', async () => {
    createAtFreeName.mockImplementation(async (pathFor, create) => {
      await create(pathFor(0));
      return pathFor(0);
    });

    await expect(createCanvasFile('/vault')).resolves.toBe('/vault/Canvas.canvas');
    expect(createFile).toHaveBeenCalledWith('/vault/Canvas.canvas', '{\n  "nodes": [],\n  "edges": []\n}');
  });
});
