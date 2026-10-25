// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { BaseCalendar } from './BaseCalendar';
import { buildCalendarWeek, shiftDay, shiftMonthDate, type BaseRow, type BaseViewDefinition } from '../../modules/bases';
import type { CalendarEvent } from '../../modules/calendar/gateway';

const gateway = vi.hoisted(() => ({
  getCalendarEvents: vi.fn(async (_path: string, _year: number, _month: number): Promise<CalendarEvent[]> => []),
}));

vi.mock('../../modules/calendar/gateway', () => gateway);

const view: BaseViewDefinition = { type: 'calendar', name: 'Schedule', order: [], dateField: 'due' };

function row(path: string, due: string): BaseRow {
  return { path, fields: { due } };
}

function todayDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDays(date: string, delta: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + delta)).toISOString().slice(0, 10);
}

function mondayOfToday(): string {
  return addDays(todayDate(), -((new Date().getDay() + 6) % 7));
}

describe('buildCalendarWeek', () => {
  it('lays out the seven Monday-first days that contain the anchor date', () => {
    const week = buildCalendarWeek([], view, '/vault', '2026-10-25')!;
    expect(week.days).toHaveLength(7);
    expect(week.days.map((day) => day.date)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(week.start).toBe('2026-10-19');
    expect(week.end).toBe('2026-10-25');
    expect(new Date(`${week.days[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('keeps the month cue of the month grid: only days of the anchor month are inMonth', () => {
    const week = buildCalendarWeek([], view, '/vault', '2026-10-01')!;
    expect(week.days[0].date).toBe('2026-09-28');
    expect(week.days.filter((day) => day.inMonth).map((day) => day.date)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
  });

  it('files each note under its day and keeps undated notes aside', () => {
    const rows = [
      row('/vault/a.md', '2026-10-21'),
      row('/vault/b.md', '2026-10-21T09:00:00'),
      row('/vault/c.md', ''),
    ];
    const week = buildCalendarWeek(rows, view, '/vault', '2026-10-25')!;
    expect(week.days.find((day) => day.date === '2026-10-21')?.rows.map((entry) => entry.path))
      .toEqual(['/vault/a.md', '/vault/b.md']);
    expect(week.undated.map((entry) => entry.path)).toEqual(['/vault/c.md']);
  });

  it('marks only the days that have a daily note', () => {
    const week = buildCalendarWeek([], view, '/vault', '2026-10-25', new Set(['2026-10-20', '2026-10-25']))!;
    expect(week.days.filter((day) => day.hasJournal).map((day) => day.date))
      .toEqual(['2026-10-20', '2026-10-25']);
  });

  it('returns nothing for an anchor that is not a date', () => {
    expect(buildCalendarWeek([], view, '/vault', 'nonsense')).toBeNull();
  });
});

describe('calendar date stepping', () => {
  it('moves by whole days across month and year boundaries', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2024-02-29', 7)).toBe('2024-03-07');
    expect(shiftDay('nonsense', 1)).toBeNull();
  });

  it('moves by months and clamps the day to the target month length', () => {
    expect(shiftMonthDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonthDate('2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftMonthDate('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('BaseCalendar', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    gateway.getCalendarEvents.mockResolvedValue([]);
  });

  it('renders a six-week Monday-first grid with entries and an undated counter', async () => {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[row('/vault/Release.md', `${month}-01`), row('/vault/Idea.md', '')]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    expect(renderer!.container.querySelectorAll('.q-base-calendar__weekdays span')).toHaveLength(7);
    expect(renderer!.container.querySelectorAll('.q-base-calendar__day')).toHaveLength(42);
    const cell = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-calendar__day')]
      .find((candidate) => candidate.getAttribute('aria-label') === `${month}-01`)!;
    expect(cell.textContent).toContain('Release');
    expect(renderer!.container.querySelector('.q-base-calendar__undated')?.textContent).toContain('1');
  });

  it('moves to the neighbouring month with the toolbar buttons', async () => {
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    const label = () => renderer!.container.querySelector('.q-base-calendar__month')?.textContent;
    const before = label();
    act(() => {
      renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Next month"]')!.click();
    });
    await actAndSettle();
    expect(label()).not.toBe(before);

    act(() => {
      renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Previous month"]')!.click();
    });
    await actAndSettle();
    expect(label()).toBe(before);
  });

  it('creates a note on the day whose add button was pressed', async () => {
    const onCreateDay = vi.fn(async () => undefined);
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onCreateDay={onCreateDay}
        />,
      );
    });
    await actAndSettle();

    const cell = renderer!.container.querySelector<HTMLElement>('.q-base-calendar__day--today')!;
    const date = cell.getAttribute('aria-label')!;
    act(() => cell.querySelector<HTMLButtonElement>('.q-base-calendar__add')!.click());
    await actAndSettle();
    expect(onCreateDay).toHaveBeenCalledWith(date);
  });

  it('marks the days that have a daily note and opens it on click', async () => {
    const onOpenJournal = vi.fn();
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    const date = `${month}-12`;
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          journalDays={new Set([date])}
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onOpenJournal={onOpenJournal}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    const marked = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-calendar__journal')];
    expect(marked).toHaveLength(1);
    expect(marked[0].closest('.q-base-calendar__day')?.getAttribute('aria-label')).toBe(date);
    act(() => marked[0].click());
    await actAndSettle();
    expect(onOpenJournal).toHaveBeenCalledWith(date);
  });

  it('marks only the days that have events from the index', async () => {
    const date = todayDate();
    gateway.getCalendarEvents.mockResolvedValue([
      { path: '/vault/Standup.md', date, time: '09:30', title: 'Standup', line: 3, byteOffset: 120 },
      { path: '/vault/Review.md', date, time: null, title: 'Review', line: 8, byteOffset: 240 },
    ]);
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    const markers = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-calendar__events')];
    expect(markers).toHaveLength(1);
    expect(markers[0].closest('.q-base-calendar__day')?.getAttribute('aria-label')).toBe(date);
    expect(markers[0].textContent).toBe('2');

    const other = [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-calendar__day')]
      .find((candidate) => candidate.getAttribute('aria-label') !== date && !candidate.classList.contains('q-base-calendar__day--outside'))!;
    expect(other.querySelector('.q-base-calendar__events')).toBeNull();
  });

  it('opens the events panel on marker click and opens the note at the event offset', async () => {
    const date = todayDate();
    const onOpenEvent = vi.fn();
    gateway.getCalendarEvents.mockResolvedValue([
      { path: '/vault/Standup.md', date, time: '09:30', title: 'Standup', line: 3, byteOffset: 120 },
      { path: '/vault/Review.md', date, time: null, title: 'Review', line: 8, byteOffset: 240 },
    ]);
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={onOpenEvent}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    act(() => renderer!.container.querySelector<HTMLButtonElement>('.q-base-calendar__day-number')!.click());
    await actAndSettle();

    const panel = renderer!.container.querySelector('.q-base-calendar__events-panel')!;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.querySelector('.q-base-calendar__events-head')?.textContent).toContain(date);

    const events = [...panel.querySelectorAll<HTMLButtonElement>('.q-base-calendar__event')];
    expect(events).toHaveLength(2);
    expect(events[0].textContent).toContain('09:30');
    expect(events[0].textContent).toContain('Standup');
    expect(events[1].textContent).toContain('Review');

    act(() => events[0].click());
    await actAndSettle();
    expect(onOpenEvent).toHaveBeenCalledWith('/vault/Standup.md', 120);
  });

  it('hides the events panel when the close button is pressed', async () => {
    const date = todayDate();
    gateway.getCalendarEvents.mockResolvedValue([
      { path: '/vault/Standup.md', date, time: '09:30', title: 'Standup', line: 3, byteOffset: 120 },
    ]);
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    act(() => renderer!.container.querySelector<HTMLButtonElement>('.q-base-calendar__day-number')!.click());
    await actAndSettle();
    expect(renderer!.container.querySelector('.q-base-calendar__events-panel')).not.toBeNull();

    act(() => renderer!.container.querySelector<HTMLButtonElement>('.q-base-calendar__events-close')!.click());
    await actAndSettle();
    expect(renderer!.container.querySelector('.q-base-calendar__events-panel')).toBeNull();
  });

  it('keeps the calendar usable when the event index fails', async () => {
    gateway.getCalendarEvents.mockRejectedValue(new Error('offline'));
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[row('/vault/Release.md', `${todayDate()}`)]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    expect(gateway.getCalendarEvents).toHaveBeenCalledWith('/vault', new Date().getFullYear(), new Date().getMonth() + 1);
    expect(renderer!.container.querySelector('.q-base-calendar__events')).toBeNull();
    expect(renderer!.container.textContent).toContain('Release');
  });

  it('switches to a single Monday-first week and steps by seven days', async () => {
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();

    act(() => renderer!.container.querySelector<HTMLButtonElement>('.q-segmented-control__button:nth-child(2)')!.click());
    await actAndSettle();

    const labels = () => [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-calendar__day')]
      .map((cell) => cell.getAttribute('aria-label'));
    expect(labels()).toHaveLength(7);
    expect(labels()).toEqual(Array.from({ length: 7 }, (_, index) => addDays(mondayOfToday(), index)));

    act(() => renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click());
    await actAndSettle();
    expect(labels()).toEqual(Array.from({ length: 7 }, (_, index) => addDays(mondayOfToday(), index + 7)));
  });

  it('creates a note from a week cell and keeps the undated counter', async () => {
    const onCreateDay = vi.fn(async () => undefined);
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[row('/vault/Idea.md', '')]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onCreateDay={onCreateDay}
        />,
      );
    });
    await actAndSettle();

    act(() => renderer!.container.querySelector<HTMLButtonElement>('.q-segmented-control__button:nth-child(2)')!.click());
    await actAndSettle();

    expect(renderer!.container.querySelector('.q-base-calendar__undated')?.textContent).toContain('1');
    const cell = renderer!.container.querySelector<HTMLElement>('.q-base-calendar__day--today')!;
    const date = cell.getAttribute('aria-label')!;
    act(() => cell.querySelector<HTMLButtonElement>('.q-base-calendar__add')!.click());
    await actAndSettle();
    expect(onCreateDay).toHaveBeenCalledWith(date);
  });

  it('loads events for both months when the week straddles a month boundary', async () => {
    act(() => {
      renderer = mountDom(
        <BaseCalendar
          rows={[]}
          view={view}
          workspacePath="/vault"
          onOpen={vi.fn()}
          onOpenEvent={vi.fn()}
          onCreateDay={vi.fn(async () => undefined)}
        />,
      );
    });
    await actAndSettle();
    act(() => renderer!.container.querySelector<HTMLButtonElement>('.q-segmented-control__button:nth-child(2)')!.click());
    await actAndSettle();

    const labels = () => [...renderer!.container.querySelectorAll<HTMLElement>('.q-base-calendar__day')]
      .map((cell) => cell.getAttribute('aria-label')!);
    for (let attempt = 0; attempt < 6 && new Set(labels().map((label) => label.slice(0, 7))).size < 2; attempt += 1) {
      act(() => renderer!.container.querySelector<HTMLButtonElement>('[aria-label="Next week"]')!.click());
      await actAndSettle();
    }

    const months = [...new Set(labels().map((label) => label.slice(0, 7)))];
    expect(months).toHaveLength(2);
    const asked = new Set(gateway.getCalendarEvents.mock.calls.map((call) => (
      `${call[1]}-${String(call[2]).padStart(2, '0')}`
    )));
    expect(months.every((month) => asked.has(month))).toBe(true);
  });
});
