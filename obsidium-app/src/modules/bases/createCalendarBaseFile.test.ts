import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAtFreeName, createFile } = vi.hoisted(() => ({
  createAtFreeName: vi.fn(),
  createFile: vi.fn(),
}));

vi.mock('../documents/fileGateway', () => ({ createAtFreeName, createFile }));

import { parseBase } from './baseFormat';
import { buildCalendarBase, createCalendarBaseFile } from './index';

describe('createCalendarBaseFile', () => {
  beforeEach(() => {
    createAtFreeName.mockReset();
    createFile.mockReset();
  });

  it('uses a free Base name and creates a Calendar view', async () => {
    createAtFreeName.mockImplementation(async (pathFor, create) => {
      expect(pathFor(0)).toBe('/vault/Calendar.base');
      return create('/vault/Calendar (1).base');
    });
    createFile.mockImplementation(async (_path: string, content: string) => {
      expect(parseBase(content).views).toMatchObject([
        { type: 'calendar', name: 'Calendar (1)', dateField: 'date' },
      ]);
      return '/vault/Calendar (1).base';
    });

    await expect(createCalendarBaseFile('/vault')).resolves.toBe('/vault/Calendar (1).base');
    expect(createFile).toHaveBeenCalledWith('/vault/Calendar (1).base', expect.any(String));
  });

  it('returns null when the free-name factory is exhausted', async () => {
    createAtFreeName.mockResolvedValue(null);

    await expect(createCalendarBaseFile('/vault')).resolves.toBeNull();
    expect(createFile).not.toHaveBeenCalled();
  });

  it('propagates a non-conflict file creation failure', async () => {
    createAtFreeName.mockImplementation(async (pathFor, create) => create(pathFor(0)));
    createFile.mockRejectedValue(new Error('disk full'));

    await expect(createCalendarBaseFile('/vault')).rejects.toThrow('disk full');
  });
});

it('builds a valid Calendar Base definition', () => {
  expect(parseBase(buildCalendarBase('Calendar')).views).toMatchObject([
    { type: 'calendar', name: 'Calendar', dateField: 'date' },
  ]);
});
