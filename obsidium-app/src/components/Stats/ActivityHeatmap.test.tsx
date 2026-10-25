// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { plural, t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { formatDayNumber, localDayNumber, type NoteTimestamp } from '../../modules/stats';
import { ActivityHeatmap } from './ActivityHeatmap';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

const mockedInvoke = vi.mocked(invoke);

function daysAgo(days: number, hour = 12): number {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

function note(path: string, createdMs: number, modifiedMs: number): NoteTimestamp {
  return { path, createdNs: createdMs * 1_000_000, modifiedNs: modifiedMs * 1_000_000 };
}

const timestamps: NoteTimestamp[] = [
  note('a.md', daysAgo(0), daysAgo(0)),
  note('b.md', daysAgo(0), daysAgo(0)),
  note('c.md', daysAgo(40), daysAgo(0)),
  note('d.md', daysAgo(40), 0),
];

function renderer(): MountedDom {
  return mountDom(<ActivityHeatmap workspacePath="/vault" />);
}

async function settle(): Promise<void> {
  await actAndSettle();
  await actAndSettle();
  await actAndSettle();
}

function dayButtons(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>('button.q-activity-heatmap__day')];
}

function buttonFor(container: HTMLElement, day: number): HTMLButtonElement {
  const found = dayButtons(container).find(
    (button) => button.getAttribute('aria-label')?.startsWith(`${formatDayNumber(day, 'en', true)}`),
  );
  if (!found) throw new Error(`no cell for day ${day}`);
  return found;
}

describe('ActivityHeatmap', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    mockedInvoke.mockReset();
    mockedInvoke.mockResolvedValue(timestamps);
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('loads the workspace timestamps once', async () => {
    mounted = renderer();
    await settle();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(mockedInvoke).toHaveBeenCalledWith('get_note_activity', { workspacePath: '/vault' });
  });

  it('renders one labelled cell per day of the twelve month range', async () => {
    mounted = renderer();
    await settle();
    const buttons = dayButtons(mounted.container);
    expect(buttons.length).toBeGreaterThan(350);
    for (const button of buttons) {
      const label = button.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(button.getAttribute('title')).toBe(label);
    }
  });

  it('reports the count of a day in its label and on click', async () => {
    mounted = renderer();
    await settle();
    const today = localDayNumber(Date.now());
    const todayButton = buttonFor(mounted.container, today);
    const expected = t('stats.activity.dayAria', {
      date: formatDayNumber(today, 'en', true),
      notes: plural('stats.activity.notes', 2),
    });
    expect(todayButton.getAttribute('aria-label')).toBe(expected);

    await act(() => {
      todayButton.click();
    });
    await settle();
    expect(buttonFor(mounted.container, today).getAttribute('aria-pressed')).toBe('true');
    expect(mounted.container.querySelector('.q-activity-heatmap__readout')?.textContent).toBe(expected);
  });

  it('shows the empty days as zero counts', async () => {
    mounted = renderer();
    await settle();
    const empty = buttonFor(mounted.container, localDayNumber(daysAgo(10)));
    expect(empty.getAttribute('aria-label')).toBe(t('stats.activity.dayAria', {
      date: formatDayNumber(localDayNumber(daysAgo(10)), 'en', true),
      notes: plural('stats.activity.notes', 0),
    }));
    expect(empty.getAttribute('data-level')).toBe('0');
  });

  it('switches between the created and modified measures', async () => {
    mounted = renderer();
    await settle();
    const footer = () => mounted?.container.querySelector('.q-activity-heatmap__total')?.textContent;
    expect(footer()).toBe(t('stats.activity.total', { count: '4' }));

    const modified = [...mounted.container.querySelectorAll<HTMLButtonElement>('.q-segmented-control__button')]
      .find((button) => button.textContent === t('stats.activity.modified'));
    expect(modified).toBeTruthy();
    await act(() => {
      modified?.click();
    });
    await settle();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
    expect(footer()).toBe(t('stats.activity.total', { count: '3' }));
  });

  it('keeps the measure under the caller control when asked', async () => {
    const onMeasureChange = vi.fn();
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" measure="modified" onMeasureChange={onMeasureChange} />);
    await settle();
    expect(mounted.container.querySelector('.q-activity-heatmap__total')?.textContent)
      .toBe(t('stats.activity.total', { count: '3' }));
    const created = [...mounted.container.querySelectorAll<HTMLButtonElement>('.q-segmented-control__button')]
      .find((button) => button.textContent === t('stats.activity.created'));
    await act(() => {
      created?.click();
    });
    await settle();
    expect(onMeasureChange).toHaveBeenCalledWith('created');
    expect(mounted.container.querySelector('.q-activity-heatmap__total')?.textContent)
      .toBe(t('stats.activity.total', { count: '3' }));
  });

  it('reports a failed load instead of an empty grid', async () => {
    mockedInvoke.mockRejectedValue(new Error('index is not ready'));
    mounted = renderer();
    await settle();
    const alert = mounted.container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(t('stats.activity.failed', { reason: 'index is not ready' }));
    expect(dayButtons(mounted.container)).toHaveLength(0);
  });

  it('renders nothing without a workspace', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath={null} />);
    await settle();
    expect(mounted.container.querySelector('.q-activity-heatmap')).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
