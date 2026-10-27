import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAtFreeName, createFile } = vi.hoisted(() => ({
  createAtFreeName: vi.fn(),
  createFile: vi.fn(),
}));

vi.mock('../documents/fileGateway', () => ({ createAtFreeName, createFile }));

import { parseBase } from './baseFormat';
import { createBaseFile } from './createBaseFile';

describe('createBaseFile', () => {
  beforeEach(() => {
    createAtFreeName.mockReset();
    createFile.mockReset();
  });

  it('creates a named Table Base and uses a free file name', async () => {
    createAtFreeName.mockImplementation(async (pathFor, create) => {
      expect(pathFor(0)).toBe('/vault/Base.base');
      return create('/vault/Base (1).base');
    });
    createFile.mockImplementation(async (_path: string, content: string) => {
      expect(parseBase(content).views).toEqual([
        { type: 'table', name: 'Base (1)', order: ['file.name'] },
      ]);
      return '/vault/Base (1).base';
    });

    await expect(createBaseFile('/vault')).resolves.toBe('/vault/Base (1).base');
    expect(createFile).toHaveBeenCalledWith('/vault/Base (1).base', expect.any(String));
  });

  it('returns null when no free file name is available', async () => {
    createAtFreeName.mockResolvedValue(null);

    await expect(createBaseFile('/vault')).resolves.toBeNull();
    expect(createFile).not.toHaveBeenCalled();
  });

  it('propagates file creation errors', async () => {
    createAtFreeName.mockImplementation(async (_pathFor, create) => create('/vault/Base.base'));
    createFile.mockRejectedValue(new Error('disk full'));

    await expect(createBaseFile('/vault')).rejects.toThrow('disk full');
  });
});
