import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushCanvasDocuments, registerCanvasFlush } from './persistence';

describe('Canvas persistence', () => {
  const unregister: Array<() => void> = [];

  afterEach(() => {
    unregister.splice(0).forEach((dispose) => dispose());
  });

  it('waits for every open board before allowing the app to close', async () => {
    const first = vi.fn(async () => true);
    const second = vi.fn(async () => false);
    unregister.push(registerCanvasFlush(first), registerCanvasFlush(second));

    await expect(flushCanvasDocuments()).resolves.toBe(false);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });
});
