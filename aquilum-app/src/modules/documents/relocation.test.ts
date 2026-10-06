import { beforeEach, describe, expect, it, vi } from 'vitest';

const sync = vi.hoisted(() => ({
  clearLocalDoc: vi.fn(async () => undefined),
  disconnectDoc: vi.fn(),
}));
const records = vi.hoisted(() => ({
  moveSyncRecord: vi.fn(async () => undefined),
  forgetSyncRecord: vi.fn(async () => undefined),
}));

vi.mock('../sync', () => ({
  clearLocalDoc: sync.clearLocalDoc,
  disconnectDoc: sync.disconnectDoc,
}));
vi.mock('../docSync', () => records);

import { closeDoc, getManagedWriterForPath, getOpenDoc, getOrCreateDoc, setManagedWriter } from '../docs';
import type { DocumentFileWriter } from './DocumentFileWriter';
import { applyRelocation } from './relocation';

function openWithWriter(path: string) {
  const doc = getOrCreateDoc(path);
  const writer = {
    adoptPath: vi.fn(),
    flush: vi.fn(async () => undefined),
    idle: vi.fn(async () => undefined),
  };
  setManagedWriter(doc, writer as unknown as DocumentFileWriter);
  return { doc, writer };
}

function targets() {
  return { renamed: vi.fn(), deleted: vi.fn() };
}

describe('applyRelocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const path of ['C:/vault/Old.md', 'C:/vault/New.md', 'C:/vault/Gone.md']) closeDoc(path);
  });

  it('keeps an open note alive under its new path', async () => {
    const { doc, writer } = openWithWriter('C:/vault/Old.md');
    const ui = targets();

    await applyRelocation({ moves: [{ from: 'C:/vault/Old.md', to: 'C:/vault/New.md' }], removed: [] }, ui);

    expect(getOpenDoc('C:/vault/New.md')).toBe(doc);
    expect(getOpenDoc('C:/vault/Old.md')).toBeNull();
    expect(getManagedWriterForPath('C:/vault/New.md')).toBe(writer);
    expect(writer.adoptPath).toHaveBeenCalledWith('C:/vault/New.md');
    expect(ui.renamed).toHaveBeenCalledWith('C:/vault/Old.md', 'C:/vault/New.md');
    expect(records.moveSyncRecord).toHaveBeenCalledWith('C:/vault/Old.md', 'C:/vault/New.md');
    expect(sync.clearLocalDoc).not.toHaveBeenCalled();
  });

  it('forgets the local copy of a closed note that moved', async () => {
    await applyRelocation({ moves: [{ from: 'C:/vault/Old.md', to: 'C:/vault/New.md' }], removed: [] }, targets());

    expect(records.moveSyncRecord).toHaveBeenCalledWith('C:/vault/Old.md', 'C:/vault/New.md');
    expect(sync.clearLocalDoc).toHaveBeenCalledWith('C:/vault/Old.md');
  });

  it('closes a removed note and forgets everything kept for its path', async () => {
    openWithWriter('C:/vault/Gone.md');
    const ui = targets();

    await applyRelocation({ moves: [], removed: ['C:/vault/Gone.md'] }, ui);

    expect(getOpenDoc('C:/vault/Gone.md')).toBeNull();
    expect(ui.deleted).toHaveBeenCalledWith('C:/vault/Gone.md');
    expect(sync.clearLocalDoc).toHaveBeenCalledWith('C:/vault/Gone.md');
    expect(records.forgetSyncRecord).toHaveBeenCalledWith('C:/vault/Gone.md');
  });

  it('is harmless when the same move arrives twice', async () => {
    const { doc } = openWithWriter('C:/vault/Old.md');
    const event = { moves: [{ from: 'C:/vault/Old.md', to: 'C:/vault/New.md' }], removed: [] };

    await applyRelocation(event, targets());
    await applyRelocation(event, targets());

    expect(getOpenDoc('C:/vault/New.md')).toBe(doc);
  });
});
