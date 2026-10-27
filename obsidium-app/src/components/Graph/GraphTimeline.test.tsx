// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { t } from '../../i18n';
import { GraphTimeline } from './GraphTimeline';

const graphViewStyles = readFileSync(
  resolve(process.cwd(), 'src/components/Graph/GraphView.css'),
  'utf8',
);

describe('GraphTimeline', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    vi.useRealTimers();
  });

  it('sizes expanded controls to the graph pane instead of the viewport', () => {
    expect(graphViewStyles).toMatch(
      /\.q-graph-timeline__controls\s*\{[^}]*min-width:\s*min\(420px, calc\(100% - var\(--q-space-64\)\)\);/s,
    );
  });

  it('keeps the timeline inside a narrow pane when settings are open', () => {
    expect(graphViewStyles).toMatch(
      /\.q-graph\s*\{[^}]*container-type:\s*inline-size;/s,
    );
    expect(graphViewStyles).toMatch(
      /@container\s*\(max-width:\s*760px\)\s*\{[^}]*\.q-graph:has\(> \.q-graph-settings:not\(\.q-graph-settings--collapsed\)\) \.q-graph-timeline\s*\{[^}]*right:\s*var\(--q-space-16\);[^}]*max-width:\s*calc\(100% - var\(--q-space-32\)\);/s,
    );
  });

  it('keeps settings controls reachable beneath a wrapped narrow timeline', () => {
    expect(graphViewStyles).toMatch(
      /@container\s*\(max-width:\s*760px\)\s*\{[\s\S]*?\.q-graph:has\(> \.q-graph-settings:not\(\.q-graph-settings--collapsed\)\):has\(> \.q-graph-timeline \.q-graph-timeline__controls\) > \.q-graph-settings\s*\{[^}]*padding-bottom:\s*calc\(var\(--q-space-16\) \+ var\(--q-space-128\)\);/s,
    );
    expect(graphViewStyles).toMatch(
      /\.q-graph:has\(> \.q-graph-settings:not\(\.q-graph-settings--collapsed\)\) \.q-graph-timeline__controls\s*\{[^}]*flex-wrap:\s*wrap;[^}]*min-width:\s*0;/s,
    );
    expect(graphViewStyles).toMatch(
      /\.q-graph:has\(> \.q-graph-settings:not\(\.q-graph-settings--collapsed\)\) \.q-graph-timeline__controls > span\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s,
    );
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
