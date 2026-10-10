// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { t } from '../../i18n';
import { GraphTimeline } from './GraphTimeline';

describe('GraphTimeline', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    vi.useRealTimers();
  });

  it('selects a history event and returns to the live graph', () => {
    const onSelect = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphTimeline
          events={[{ eventId: 4, atNs: 1_700_000_000_000_000_000 }, { eventId: 9, atNs: 1_700_000_060_000_000_000 }]}
          selectedEventId={null}
          loading={false}
          snapshotLoading={false}
          error={null}
          onSelect={onSelect}
          onOpenChange={() => {}}
        />,
      );
    });

    const toggle = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.timelineOpen'))!;
    act(() => toggle.click());

    const slider = renderer!.container.querySelector<HTMLInputElement>('input[type="range"]')!;
    slider.value = '0';
    act(() => { slider.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onSelect).toHaveBeenCalledWith(4);

    act(() => renderer!.update(
      <GraphTimeline
        events={[{ eventId: 4, atNs: 1_700_000_000_000_000_000 }, { eventId: 9, atNs: 1_700_000_060_000_000_000 }]}
        selectedEventId={4}
        loading={false}
        snapshotLoading={false}
        error={null}
        onSelect={onSelect}
        onOpenChange={() => {}}
      />,
    ));

    const live = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.timelineLive'))!;
    act(() => live.click());
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('plays history only after an explicit request and stops at the latest event', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphTimeline
          events={[{ eventId: 4, atNs: 1_700_000_000_000_000_000 }, { eventId: 9, atNs: 1_700_000_060_000_000_000 }]}
          selectedEventId={null}
          loading={false}
          snapshotLoading={false}
          error={null}
          onSelect={onSelect}
          onOpenChange={() => {}}
        />,
      );
    });

    const toggle = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.timelineOpen'))!;
    act(() => toggle.click());

    const play = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.timelinePlay'))!;
    act(() => play.click());
    expect(onSelect).toHaveBeenCalledWith(4);
    act(() => { vi.advanceTimersByTime(500); });
    expect(onSelect).toHaveBeenLastCalledWith(9);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('shows loading and history errors inside the open timeline', () => {
    act(() => {
      renderer = mountDom(
        <GraphTimeline
          events={[]}
          selectedEventId={null}
          loading
          snapshotLoading={false}
          error="history unavailable"
          onSelect={() => {}}
          onOpenChange={() => {}}
        />,
      );
    });
    const toggle = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.timelineOpen'))!;
    act(() => toggle.click());

    expect(renderer!.container.querySelector('[role="status"]')?.textContent)
      .toBe(t('graph.timelineLoading'));
    expect(renderer!.container.querySelector('[role="alert"]')?.textContent)
      .toBe('history unavailable');
  });

  it('restores the live graph when history controls are closed', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphTimeline
          events={[{ eventId: 4, atNs: 1_700_000_000_000_000_000 }]}
          selectedEventId={4}
          loading={false}
          snapshotLoading={false}
          error={null}
          onSelect={onSelect}
          onOpenChange={onOpenChange}
        />,
      );
    });
    const close = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.timelineOpen'))!;
    act(() => close.click());
    const opened = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.timelineClose'))!;
    act(() => opened.click());

    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('waits for each snapshot before scheduling the next playback event', () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    const events = [
      { eventId: 4, atNs: 1_700_000_000_000_000_000 },
      { eventId: 9, atNs: 1_700_000_060_000_000_000 },
    ];
    act(() => {
      renderer = mountDom(
        <GraphTimeline
          events={events}
          selectedEventId={null}
          loading={false}
          snapshotLoading
          error={null}
          onSelect={onSelect}
          onOpenChange={() => {}}
        />,
      );
    });
    const open = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.timelineOpen'))!;
    act(() => open.click());
    const play = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.timelinePlay'))!;
    act(() => play.click());
    act(() => { vi.advanceTimersByTime(1500); });
    expect(onSelect).toHaveBeenCalledTimes(1);

    act(() => renderer!.update(
      <GraphTimeline
        events={events}
        selectedEventId={4}
        loading={false}
        snapshotLoading={false}
        error={null}
        onSelect={onSelect}
        onOpenChange={() => {}}
      />,
    ));
    act(() => { vi.advanceTimersByTime(500); });
    expect(onSelect).toHaveBeenLastCalledWith(9);
  });
});
