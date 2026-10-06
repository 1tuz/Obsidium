import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { clearDocument } from 'y-indexeddb';
import { connectDoc } from './index';

const persistences = vi.hoisted(() => [] as { destroy: ReturnType<typeof vi.fn> }[]);

vi.mock('y-indexeddb', () => ({
  clearDocument: vi.fn().mockResolvedValue(undefined),
  IndexeddbPersistence: class {
    destroy = vi.fn().mockResolvedValue(undefined);
    constructor() {
      persistences.push(this);
    }
    on() {}
    off() {}
  },
}));

describe('connectDoc', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('opens the document without the local copy when IndexedDB never answers', async () => {
    let connected = false;
    void connectDoc(new Y.Doc(), 'C:/vault/Заметка.md').then(() => { connected = true; });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(connected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(connected).toBe(true);
    expect(persistences[persistences.length - 1].destroy).toHaveBeenCalled();
    expect(clearDocument).toHaveBeenCalledWith('aquilum-sync-C:/vault/Заметка.md');
  });
});
