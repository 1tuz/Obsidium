// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runViewTransition } from './index';

describe('motion helpers', () => {
  beforeEach(() => {
    document.documentElement.dataset.motion = 'on';
    vi.restoreAllMocks();
    vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }) as unknown as MediaQueryList);
    Reflect.deleteProperty(document, 'startViewTransition');
  });

  it('falls back synchronously when View Transitions are unavailable', () => {
    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('uses View Transitions when motion is enabled', () => {
    const update = vi.fn();
    const start = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });

    runViewTransition(update);

    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not create a View Transition when animations are off', () => {
    document.documentElement.dataset.motion = 'off';
    const update = vi.fn();
    const start = vi.fn((callback: () => void) => {
      callback();
      return { finished: Promise.resolve() };
    });
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });

    runViewTransition(update);

    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('honors the explicit on setting when the system prefers reduced motion', () => {
    vi.mocked(window.matchMedia).mockImplementation(() => ({
      matches: true,
    }) as MediaQueryList);
    const update = vi.fn();
    const start = vi.fn();
    Object.defineProperty(document, 'startViewTransition', { configurable: true, value: start });

    runViewTransition(update);

    expect(start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  });
});
