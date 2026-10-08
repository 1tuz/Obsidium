// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { observePaletteChanges } from './palette';

describe('observePaletteChanges', () => {
  afterEach(() => vi.restoreAllMocks());

  it('refreshes graph colors when the selected palette changes', async () => {
    const refresh = vi.fn();
    const observer = observePaletteChanges(document.documentElement, refresh);
    document.documentElement.dataset.palette = 'nord';
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(refresh).toHaveBeenCalledOnce();
    observer.disconnect();
  });
});
