import { afterEach, describe, expect, it, vi } from 'vitest';
import { getOpenDoc, getOrCreateDoc, releaseDoc, retainDoc } from './index';

describe('managed Yjs document lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('survives the StrictMode setup-cleanup-setup cycle', async () => {
    vi.useFakeTimers();
    const path = `strict-${crypto.randomUUID()}.md`;
    const doc = getOrCreateDoc(path);

    retainDoc(doc);
    releaseDoc(doc);
    retainDoc(doc);
    await vi.runAllTimersAsync();

    expect(getOpenDoc(path)).toBe(doc);
    expect(doc.isDestroyed).toBe(false);

    releaseDoc(doc);
    await vi.runAllTimersAsync();
    expect(getOpenDoc(path)).toBeNull();
    expect(doc.isDestroyed).toBe(true);
  });

  it('resolves open docs by normalized path keys', () => {
    const path = `D:\\vault\\books\\${crypto.randomUUID()}.md`;
    const doc = getOrCreateDoc(path);
    expect(getOpenDoc('D:/vault/books/' + path.split('\\').pop()!)).toBe(doc);
  });
});
