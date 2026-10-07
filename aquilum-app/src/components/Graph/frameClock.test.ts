// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrameClock } from './frameClock';

describe('FrameClock motion preference', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does not schedule another frame when motion is off', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    document.documentElement.dataset.motion = 'off';
    const clock = new FrameClock();
    clock.request(() => true);

    frames.shift()?.(16);

    expect(frames).toHaveLength(0);
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
    clock.request(() => true);

    frames.shift()?.(16);

    expect(frames).toHaveLength(1);
    clock.stop();
  });
});
