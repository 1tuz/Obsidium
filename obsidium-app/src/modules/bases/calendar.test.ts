import { describe, expect, it } from 'vitest';
import {
  buildCalendarMonth,
  calendarDate,
  calendarProperty,
  monthOf,
  shiftMonth,
  weekdayLabels,
} from './calendar';
import type { BaseRow, BaseViewDefinition } from './types';

function view(overrides: Partial<BaseViewDefinition> = {}): BaseViewDefinition {
  return { type: 'calendar', name: 'Calendar', order: [], ...overrides };
}

function row(path: string, fields: Record<string, string>): BaseRow {
  return { path, fields };
}

describe('calendarDate', () => {
  it('reads the date part of an ISO timestamp and rejects anything else', () => {
    expect(calendarDate('2026-10-23')).toBe('2026-10-23');
    expect(calendarDate('2026-10-23T18:30:00Z')).toBe('2026-10-23');
    expect(calendarDate('23.10.2026')).toBeNull();
    expect(calendarDate('2026-13-01')).toBeNull();
    expect(calendarDate('')).toBeNull();
    expect(calendarDate(undefined)).toBeNull();
  });

  it('takes the first dated entry of a list', () => {
    expect(calendarDate(['', '2026-02-01'])).toBe('2026-02-01');
  });
});

describe('buildCalendarMonth', () => {
  it('lays out a Monday-first grid that starts on the previous month', () => {
    const month = buildCalendarMonth([], view(), '/vault', { year: 2026, month: 10 });
    expect(month.days).toHaveLength(42);
    expect(month.days[0].date).toBe('2026-09-28');
    expect(month.days[0].inMonth).toBe(false);
    expect(month.days[3].date).toBe('2026-10-01');
    expect(month.days[3].inMonth).toBe(true);
  });

  it('files each note under its own day and keeps undated notes aside', () => {
    const rows = [
      row('/vault/a.md', { date: '2026-10-05' }),
      row('/vault/b.md', { date: '2026-10-05T09:00:00' }),
      row('/vault/c.md', { date: '' }),
    ];
    const month = buildCalendarMonth(rows, view({ dateField: 'date' }), '/vault', { year: 2026, month: 10 });
    const fifth = month.days.find((day) => day.date === '2026-10-05');
    expect(fifth?.rows.map((entry) => entry.path)).toEqual(['/vault/a.md', '/vault/b.md']);
    expect(month.undated.map((entry) => entry.path)).toEqual(['/vault/c.md']);
  });

  it('uses the configured date property instead of the default one', () => {
    const rows = [row('/vault/a.md', { published: '2026-10-06', date: '2026-10-07' })];
    const month = buildCalendarMonth(
      rows,
      view({ dateField: 'published' }),
      '/vault',
      { year: 2026, month: 10 },
    );
    expect(month.days.find((day) => day.date === '2026-10-06')?.rows).toHaveLength(1);
    expect(month.days.find((day) => day.date === '2026-10-07')?.rows).toHaveLength(0);
  });
});

describe('calendarProperty', () => {
  it('falls back to the date property', () => {
    expect(calendarProperty(view())).toBe('date');
    expect(calendarProperty(view({ dateField: 'due' }))).toBe('due');
  });
});

describe('shiftMonth', () => {
  it('crosses year boundaries in both directions', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 10, 3)).toEqual({ year: 2027, month: 1 });
  });
});

describe('monthOf', () => {
  it('extracts the month of an ISO date', () => {
    expect(monthOf('2026-10-23')).toEqual({ year: 2026, month: 10 });
    expect(monthOf('nonsense')).toBeNull();
  });
});

describe('weekdayLabels', () => {
  it('returns seven Monday-first labels', () => {
    const labels = weekdayLabels('ru');
    expect(labels).toHaveLength(7);
    expect(labels[0].toLowerCase()).toContain('пн');
  });
});
