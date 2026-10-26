// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { transitionThemeFrom } from './transition';

const TRANSITION_VARIABLES = [
  '--q-theme-transition-x',
  '--q-theme-transition-y',
  '--q-theme-transition-radius',
];

interface PendingTransition {
  update: () => void | Promise<void>;
  skipTransition: ReturnType<typeof vi.fn>;
  finish: () => void;
}

function installViewTransitions(): PendingTransition[] {
  const pending: PendingTransition[] = [];
  Object.defineProperty(document, 'startViewTransition', {
    configurable: true,
    value: vi.fn((update: () => void | Promise<void>) => {
      let settle: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const skipTransition = vi.fn();
      pending.push({ update, skipTransition, finish: () => settle() });
      return { finished, skipTransition };
    }),
  });
  return pending;
}

function themeVariable(name: string): string {
  return document.documentElement.style.getPropertyValue(name);
}

function clickable(left: number, top: number, width: number, height: number): HTMLElement {
  const element = document.createElement('button');
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    left, top, width, height,
  } as DOMRect);
  return element;
}

describe('transitionThemeFrom', () => {
  afterEach(() => {
    delete document.documentElement.dataset.motion;
    delete document.documentElement.dataset.viewTransition;
    for (const name of TRANSITION_VARIABLES) document.documentElement.style.removeProperty(name);
    Reflect.deleteProperty(document, 'startViewTransition');
    vi.restoreAllMocks();
  });

  it('runs a theme transition from the clicked control when motion is enabled', async () => {
    document.documentElement.dataset.motion = 'on';
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    const pending = installViewTransitions();
    const update = vi.fn();

    transitionThemeFrom(clickable(20, 30, 40, 20), update);

    expect(document.startViewTransition).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.viewTransition).toBe('theme');
    expect(themeVariable('--q-theme-transition-x')).toBe('40px');
    expect(themeVariable('--q-theme-transition-y')).toBe('40px');
    expect(Number.parseFloat(themeVariable('--q-theme-transition-radius')))
      .toBeCloseTo(Math.hypot(760, 560), 2);

    pending[0]!.update();
    expect(update).toHaveBeenCalledOnce();

    pending[0]!.finish();
    await Promise.resolve();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
    for (const name of TRANSITION_VARIABLES) expect(themeVariable(name)).toBe('');
  });

  it('switches immediately when motion is disabled', () => {
    document.documentElement.dataset.motion = 'off';
    installViewTransitions();
    const update = vi.fn();

    transitionThemeFrom(document.createElement('button'), update);

    expect(update).toHaveBeenCalledOnce();
    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(themeVariable('--q-theme-transition-x')).toBe('');
  });

  it('animates when motion is explicitly on despite the reduced-motion preference', () => {
    document.documentElement.dataset.motion = 'on';
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    installViewTransitions();
    const update = vi.fn();

    transitionThemeFrom(document.createElement('button'), update);

    expect(update).not.toHaveBeenCalled();
    expect(document.startViewTransition).toHaveBeenCalledOnce();
  });

  it('switches immediately for system motion when the system prefers reduced motion', () => {
    document.documentElement.dataset.motion = 'system';
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    installViewTransitions();
    const update = vi.fn();

    transitionThemeFrom(document.createElement('button'), update);

    expect(update).toHaveBeenCalledOnce();
    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(themeVariable('--q-theme-transition-radius')).toBe('');
  });

  it('animates for system motion when reduced motion is not requested', () => {
    document.documentElement.dataset.motion = 'system';
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    installViewTransitions();

    transitionThemeFrom(clickable(10, 10, 20, 20), vi.fn());

    expect(document.startViewTransition).toHaveBeenCalledOnce();
    expect(themeVariable('--q-theme-transition-x')).toBe('20px');
  });

  it('keeps geometry owned by the latest call when the previous transition finishes', async () => {
    document.documentElement.dataset.motion = 'on';
    vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800);
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600);
    const pending = installViewTransitions();
    const first = vi.fn();
    const second = vi.fn();

    transitionThemeFrom(clickable(20, 30, 40, 20), first);
    transitionThemeFrom(clickable(200, 100, 40, 20), second);

    expect(pending).toHaveLength(2);
    expect(pending[0]!.skipTransition).toHaveBeenCalledOnce();
    expect(themeVariable('--q-theme-transition-x')).toBe('220px');

    pending[0]!.finish();
    await Promise.resolve();
    expect(themeVariable('--q-theme-transition-x')).toBe('220px');
    expect(themeVariable('--q-theme-transition-y')).toBe('110px');

    pending[1]!.update();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();

    pending[1]!.finish();
    await Promise.resolve();
    expect(themeVariable('--q-theme-transition-x')).toBe('');
  });
});
