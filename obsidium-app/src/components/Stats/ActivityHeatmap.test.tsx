// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { plural, t } from '../../i18n';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import {
  dayIsoDate,
  formatClock,
  formatDayNumber,
  formatNoteMoment,
  localDayNumber,
  type ActivityNote,
  type NoteTimestamp,
} from '../../modules/stats';
import { ActivityHeatmap } from './ActivityHeatmap';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('../../hooks/useTauriEvent', () => ({ useTauriEvent: vi.fn() }));

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

function moment(path: string, atMs: number): ActivityNote {
  return { path, timestampNs: atMs * 1_000_000 };
}

const timestamps: NoteTimestamp[] = [
  note('a.md', daysAgo(0), daysAgo(0)),
  note('b.md', daysAgo(0), daysAgo(0)),
  note('c.md', daysAgo(40), daysAgo(0)),
  note('d.md', daysAgo(40), 0),
];

const createdToday: ActivityNote[] = [
  moment('/vault/notes/first.md', daysAgo(0, 9)),
  moment('/vault/second.md', daysAgo(0, 10)),
];
const modifiedToday: ActivityNote[] = [moment('/vault/third.md', daysAgo(0, 11))];
const recent: ActivityNote[] = [moment('/vault/notes/first.md', daysAgo(0, 9))];

interface CommandArgs {
  workspacePath?: string;
  day?: string;
  measure?: string;
  limit?: number;
  tzOffsetMinutes?: number;
}

function mockCommands(): void {
  mockedInvoke.mockImplementation(((command: string, args?: CommandArgs) => {
    if (command === 'get_note_activity') return Promise.resolve(timestamps);
    if (command === 'get_recent_changes') return Promise.resolve(recent);
    if (command === 'get_note_day_notes') {
      return Promise.resolve(args?.measure === 'modified' ? modifiedToday : createdToday);
    }
    return Promise.resolve([]);
  }) as never);
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

function dayCalls(): CommandArgs[] {
  return mockedInvoke.mock.calls
    .filter(([command]) => command === 'get_note_day_notes')
    .map(([, args]) => args as CommandArgs);
}

function noteRows(container: HTMLElement): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(
    '.q-activity-heatmap__notes button.q-activity-note__button',
  )];
}

async function openDay(container: HTMLElement, day: number): Promise<void> {
  await act(() => {
    buttonFor(container, day).click();
  });
  await settle();
}

describe('ActivityHeatmap', () => {
  let mounted: MountedDom | null = null;

  beforeEach(() => {
    mockedInvoke.mockReset();
    mockCommands();
  });

  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  it('loads the workspace activity and the recent changes once', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
    await settle();
    const activityCalls = mockedInvoke.mock.calls.filter(([command]) => command === 'get_note_activity');
    expect(activityCalls).toEqual([['get_note_activity', { workspacePath: '/vault' }]]);
    const recentCalls = mockedInvoke.mock.calls.filter(([command]) => command === 'get_recent_changes');
    expect(recentCalls).toHaveLength(1);
    expect(recentCalls[0][1]).toMatchObject({ workspacePath: '/vault' });
  });

  it('renders one labelled cell per day of the twelve month range', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
    await settle();
    const buttons = dayButtons(mounted.container);
    expect(buttons.length).toBeGreaterThan(350);
    for (const button of buttons) {
      const label = button.getAttribute('aria-label');
      expect(label).toBeTruthy();
      expect(button.getAttribute('title')).toBe(label);
    }
  });

  it('reports the count of a day in its label', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
    await settle();
    const today = localDayNumber(Date.now());
    const expected = t('stats.activity.dayAria', {
      date: formatDayNumber(today, 'en', true),
      notes: plural('stats.activity.notes', 2),
    });
    expect(buttonFor(mounted.container, today).getAttribute('aria-label')).toBe(expected);
  });

  it('shows the empty days as zero counts', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
    await settle();
    const empty = buttonFor(mounted.container, localDayNumber(daysAgo(10)));
    expect(empty.getAttribute('aria-label')).toBe(t('stats.activity.dayAria', {
      date: formatDayNumber(localDayNumber(daysAgo(10)), 'en', true),
      notes: plural('stats.activity.notes', 0),
    }));
    expect(empty.getAttribute('data-level')).toBe('0');
  });

  it('opens the notes of the clicked day and returns to the calendar', async () => {
    const onOpenNote = vi.fn();
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" onOpenNote={onOpenNote} />);
    await settle();
    const today = localDayNumber(Date.now());

    await openDay(mounted.container, today);

    expect(dayCalls()).toEqual([{
      workspacePath: '/vault',
      day: dayIsoDate(today),
      measure: 'created',
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
    }]);
    expect(dayButtons(mounted.container)).toHaveLength(0);
    expect(mounted.container.querySelector('.q-activity-heatmap__day-title')?.textContent)
      .toBe(formatDayNumber(today, 'en', true));
    expect(mounted.container.querySelector('.q-activity-heatmap__day-count')?.textContent)
      .toBe(plural('stats.activity.notes', 2));
    const rows = noteRows(mounted.container);
    expect(rows.map((row) => row.querySelector('.q-activity-note__title')?.textContent))
      .toEqual(['first', 'second']);
    expect(rows.map((row) => row.querySelector('.q-activity-note__detail')?.textContent))
      .toEqual([
        formatClock(createdToday[0].timestampNs, 'en'),
        formatClock(createdToday[1].timestampNs, 'en'),
      ]);

    await act(() => {
      rows[0].click();
    });
    expect(onOpenNote).toHaveBeenCalledWith('/vault/notes/first.md');

    const back = mounted.container.querySelector<HTMLButtonElement>('.q-activity-heatmap__back');
    expect(back?.textContent).toBe(t('stats.activity.back'));
    await act(() => {
      back?.click();
    });
    await settle();
    expect(dayButtons(mounted.container).length).toBeGreaterThan(350);
  });

  it('lists the notes the current measure reports', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
    await settle();
    const modified = [...mounted.container.querySelectorAll<HTMLButtonElement>('.q-segmented-control__button')]
      .find((button) => button.textContent === t('stats.activity.modified'));
    await act(() => {
      modified?.click();
    });
    await settle();
    await openDay(mounted.container, localDayNumber(Date.now()));
    const calls = dayCalls();
    expect(calls[calls.length - 1].measure).toBe('modified');
    expect(noteRows(mounted.container).map((row) => row.getAttribute('title')))
      .toEqual(['/vault/third.md']);
  });

  it('switches between the created and modified measures without reloading timestamps', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
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
    const activityCalls = mockedInvoke.mock.calls.filter(([command]) => command === 'get_note_activity');
    expect(activityCalls).toHaveLength(1);
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

  it('reports an empty day instead of a blank list', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
    await settle();
    mockedInvoke.mockImplementation(((command: string) => {
      if (command === 'get_note_activity') return Promise.resolve(timestamps);
      if (command === 'get_recent_changes') return Promise.resolve(recent);
      return Promise.resolve([]);
    }) as never);
    await openDay(mounted.container, localDayNumber(daysAgo(10)));
    expect(mounted.container.querySelector('.q-activity-heatmap__day-panel')?.textContent)
      .toContain(t('stats.activity.dayNotesEmpty'));
    expect(noteRows(mounted.container)).toHaveLength(0);
  });

  it('reports a failed day load', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
    await settle();
    mockedInvoke.mockImplementation(((command: string) => {
      if (command === 'get_note_day_notes') return Promise.reject(new Error('database is locked'));
      if (command === 'get_note_activity') return Promise.resolve(timestamps);
      return Promise.resolve(recent);
    }) as never);
    await openDay(mounted.container, localDayNumber(Date.now()));
    const alert = mounted.container.querySelector('.q-activity-heatmap__day-panel [role="alert"]');
    expect(alert?.textContent).toBe(t('stats.activity.dayNotesFailed', { reason: 'database is locked' }));
  });

  it('reports a failed load instead of an empty grid', async () => {
    mockedInvoke.mockImplementation(((command: string) => {
      if (command === 'get_note_activity') return Promise.reject(new Error('index is not ready'));
      return Promise.resolve(recent);
    }) as never);
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
    await settle();
    const alert = mounted.container.querySelector('.q-activity-heatmap > .q-activity-heatmap__status[role="alert"]');
    expect(alert?.textContent).toBe(t('stats.activity.failed', { reason: 'index is not ready' }));
    expect(dayButtons(mounted.container)).toHaveLength(0);
  });

  it('shows the recent changes next to the calendar', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath="/vault" />);
    await settle();
    const feed = mounted.container.querySelector('.q-recent-changes');
    expect(feed?.querySelector('.q-recent-changes__title')?.textContent)
      .toBe(t('stats.activity.recentTitle'));
    expect(feed?.querySelector('.q-activity-note__detail')?.textContent)
      .toBe(formatNoteMoment(recent[0].timestampNs, 'en'));
  });

  it('renders nothing without a workspace', async () => {
    mounted = mountDom(<ActivityHeatmap workspacePath={null} />);
    await settle();
    expect(mounted.container.querySelector('.q-activity-heatmap')).toBeNull();
    expect(mockedInvoke).not.toHaveBeenCalled();
  });
});
