// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard';

function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

describe('copyText', () => {
  beforeEach(() => {
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: vi.fn(() => true),
    });
  });

  afterEach(() => {
    stubClipboard(undefined);
    Reflect.deleteProperty(document, 'execCommand');
    vi.restoreAllMocks();
  });

  it('returns true when the clipboard API succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it('falls back to execCommand when the clipboard API rejects', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    vi.mocked(document.execCommand).mockReturnValue(true);

    await expect(copyText('hello')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('returns the execCommand result when the fallback fails', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    vi.mocked(document.execCommand).mockReturnValue(false);

    await expect(copyText('hello')).resolves.toBe(false);
  });

  it('falls back when the clipboard API is missing', async () => {
    stubClipboard(undefined);

    await expect(copyText('hello')).resolves.toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith('copy');
  });

  it('removes the temporary textarea after copying', async () => {
    stubClipboard(undefined);

    await copyText('hello');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.body.childElementCount).toBe(0);
  });
});
