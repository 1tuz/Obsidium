// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runMotionTransition, runViewTransition } from './index';

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

function mockReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(() => ({
    matches: reduce,
    media: '(prefers-reduced-motion: reduce)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
}

describe('motion helpers', () => {
  beforeEach(() => {
    document.documentElement.dataset.motion = 'on';
    delete document.documentElement.dataset.viewTransition;
    vi.restoreAllMocks();
    mockReducedMotion(false);
    Reflect.deleteProperty(document, 'startViewTransition');
  });

  it('falls back synchronously when View Transitions are unavailable', () => {
    const update = vi.fn();
    runViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('uses View Transitions when motion is enabled', () => {
    const pending = installViewTransitions();
    const update = vi.fn();

    runViewTransition(update);

    expect(document.startViewTransition).toHaveBeenCalledTimes(1);
    expect(document.documentElement.dataset.viewTransition).toBe('view');
    expect(update).not.toHaveBeenCalled();

    pending[0]!.update();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('removes the transition scope flag when the transition finishes', async () => {
    const pending = installViewTransitions();
    runViewTransition(vi.fn());

    pending[0]!.update();
    pending[0]!.finish();
    await Promise.resolve();

    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
  });

  it('does not create a View Transition when animations are off', () => {
    document.documentElement.dataset.motion = 'off';
    installViewTransitions();
    const update = vi.fn();

    runViewTransition(update);

    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('does not create a View Transition for system motion with reduced motion', () => {
    document.documentElement.dataset.motion = 'system';
    mockReducedMotion(true);
    installViewTransitions();
    const update = vi.fn();

    runViewTransition(update);

    expect(document.startViewTransition).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('honors the explicit on setting when the system prefers reduced motion', () => {
    mockReducedMotion(true);
    installViewTransitions();
    const update = vi.fn();

    runViewTransition(update);

    expect(document.startViewTransition).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('lets the latest call win and runs every update exactly once', async () => {
    const pending = installViewTransitions();
    const first = vi.fn();
    const second = vi.fn();

    runViewTransition(first);
    runViewTransition(second);

    expect(pending).toHaveLength(2);
    expect(pending[0]!.skipTransition).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();

    pending[1]!.update();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    pending[1]!.update();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    pending[0]!.finish();
    await Promise.resolve();
    expect(document.documentElement.dataset.viewTransition).toBe('view');

    pending[1]!.finish();
    await Promise.resolve();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
  });

  it('supersedes a pending transition when motion switches off', async () => {
    const pending = installViewTransitions();
    const first = vi.fn();
    const second = vi.fn();

    runViewTransition(first);
    document.documentElement.dataset.motion = 'off';
    runViewTransition(second);

    expect(pending[0]!.skipTransition).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();

    pending[0]!.update();
    pending[0]!.finish();
    await Promise.resolve();
    expect(first).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.viewTransition).toBeUndefined();
  });

  it('runs the latest update when a carried async update rejects', async () => {
    const pending = installViewTransitions();
    const error = new Error('previous update failed');
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const first = vi.fn(async () => {
      throw error;
    });
    const second = vi.fn();

    runMotionTransition('view', first);
    runMotionTransition('view', second);

    await pending[1]!.update();

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith('Failed to apply superseded motion update', error);

    pending[1]!.finish();
    await Promise.resolve();
  });
});
