import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataviewOutput } from '../../../../modules/docs/dataview';
import { evaluateDataviewQuery } from './run';

vi.mock('../../../../modules/docs/dataview', () => ({
  dataviewErrorMessage: vi.fn(() => 'query failed'),
  runDataviewQuery: vi.fn(),
}));

const { runDataviewQuery } = await import('../../../../modules/docs/dataview');

const OUTPUT: DataviewOutput = {
  shape: 'list',
  refreshSeconds: null,
  title: null,
  columns: [],
  rows: [],
  width: 0,
  total: 0,
  truncated: false,
};

describe('dataview query flights', () => {
  beforeEach(() => vi.mocked(runDataviewQuery).mockReset());

  it('shares simultaneous requests within a vault and separates them across vaults', async () => {
    vi.mocked(runDataviewQuery).mockResolvedValue(OUTPUT);

    const first = evaluateDataviewQuery('/vault-one', '/shared/note.md', 'LIST');
    const duplicate = evaluateDataviewQuery('/vault-one', '/shared/note.md', 'LIST');
    const otherVault = evaluateDataviewQuery('/vault-two', '/shared/note.md', 'LIST');

    expect(first).toBe(duplicate);
    expect(runDataviewQuery).toHaveBeenCalledTimes(2);
    await Promise.all([first, duplicate, otherVault]);
  });
});
