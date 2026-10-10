// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameClock } from './frameClock';

describe('FrameClock motion preference', () => {
  afterEach(() => {
    delete document.documentElement.dataset.motion;
    vi.unstubAllGlobals();
  });

  it('applies a frame synchronously when motion is off', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    document.documentElement.dataset.motion = 'off';
    const clock = new FrameClock();
    const step = vi.fn(() => true);
    clock.request(step);

    expect(frames).toHaveLength(0);
    expect(step).toHaveBeenCalledWith(0, 0, false);
    clock.stop();
  });

  it('continues scheduling frames when motion is on', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    document.documentElement.dataset.motion = 'on';
    const clock = new FrameClock();
    clock.request((_seconds, _time, animate) => animate);

    frames.shift()?.(16);

    expect(frames).toHaveLength(1);
    clock.stop();
  });

  it('does not schedule frames after a step has settled', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    document.documentElement.dataset.motion = 'on';
    const clock = new FrameClock();
    const step = vi.fn(() => false);
    clock.request(step);

    frames.shift()?.(16);

    expect(step).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
    clock.stop();
  });

  it('uses the live system preference and stops scheduling after reduced motion turns on', () => {
    const frames: FrameRequestCallback[] = [];
    const preference = { matches: false };
    vi.spyOn(window, 'matchMedia').mockImplementation(() => preference as MediaQueryList);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    document.documentElement.dataset.motion = 'system';
    const clock = new FrameClock();
    const step = vi.fn((_seconds: number, _time: number, animate: boolean) => animate);
    clock.request(step);

    frames.shift()?.(16);
    preference.matches = true;
    frames.shift()?.(32);

    expect(step.mock.calls.map(([, time, animate]) => [time, animate])).toEqual([
      [16, true],
      [32, false],
    ]);
    expect(frames).toHaveLength(0);
    clock.stop();
  });

  it('finishes the pending frame if motion is disabled mid-transition', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    document.documentElement.dataset.motion = 'on';
    const clock = new FrameClock();
    const step = vi.fn((_seconds: number, _time: number, animate: boolean) => animate);
    clock.request(step);
    document.documentElement.dataset.motion = 'off';

    frames.shift()?.(16);

    expect(step).toHaveBeenCalledWith(0, 16, false);
    expect(frames).toHaveLength(0);
    clock.stop();
  });

  it('cancels a pending frame and applies the next request synchronously when motion is off', () => {
    const frames: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    document.documentElement.dataset.motion = 'on';
    const clock = new FrameClock();
    const step = vi.fn(() => true);
    clock.request(() => true);
    document.documentElement.dataset.motion = 'off';

    clock.request(step);

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(step).toHaveBeenCalledWith(0, 0, false);
    expect(frames).toHaveLength(1);
    clock.stop();
  });

  it('honors the system reduced-motion preference', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.documentElement.dataset.motion = 'system';
    const clock = new FrameClock();
    const step = vi.fn();

    clock.request(step);

    expect(step).toHaveBeenCalledWith(0, 0, false);
    clock.stop();
  });

  it('cancels a scheduled frame when the render context is abandoned', () => {
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal('requestAnimationFrame', () => 17);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame);
    document.documentElement.dataset.motion = 'on';
    const clock = new FrameClock();
    const step = vi.fn(() => true);
    clock.request(step);

    clock.abandon();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(17);
    expect(step).not.toHaveBeenCalled();
  });
});
