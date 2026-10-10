// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transitionThemeFrom } from './transition';

describe('transitionThemeFrom', () => {
  afterEach(() => {
    delete document.documentElement.dataset.motion;
    document.documentElement.style.removeProperty('--q-theme-transition-x');
    document.documentElement.style.removeProperty('--q-theme-transition-y');
    document.documentElement.style.removeProperty('--q-theme-transition-radius');
    Reflect.deleteProperty(document, 'startViewTransition');
    vi.restoreAllMocks();
  });

  it('runs a theme transition from the clicked control when motion is enabled', () => {
    document.documentElement.dataset.motion = 'on';
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    const element = document.createElement('button');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      left: 20, top: 30, width: 40, height: 20,
    } as DOMRect);
    const update = vi.fn();
    const finished = Promise.resolve();
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: vi.fn((callback: () => void) => {
        callback();
        return { finished };
      }),
    });

    transitionThemeFrom(element, update);

    expect(document.startViewTransition).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.style.getPropertyValue('--q-theme-transition-x')).toBe('40px');
    expect(document.documentElement.style.getPropertyValue('--q-theme-transition-y')).toBe('40px');
    expect(Number.parseFloat(document.documentElement.style.getPropertyValue('--q-theme-transition-radius')))
      .toBeCloseTo(Math.hypot(760, 560), 2);
  });

  it('switches immediately when motion is disabled', () => {
    document.documentElement.dataset.motion = 'off';
    const update = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: vi.fn(),
    });

    transitionThemeFrom(document.createElement('button'), update);

    expect(update).toHaveBeenCalledOnce();
    expect(document.startViewTransition).not.toHaveBeenCalled();
  });

  it('switches immediately when reduced motion is requested', () => {
    document.documentElement.dataset.motion = 'on';
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const update = vi.fn();
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: vi.fn(),
    });

    transitionThemeFrom(document.createElement('button'), update);

    expect(update).toHaveBeenCalledOnce();
    expect(document.startViewTransition).not.toHaveBeenCalled();
  });
});
