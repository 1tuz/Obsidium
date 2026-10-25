import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  activityLevel,
  buildActivityGrid,
  countByDay,
  dayIsoDate,
  dayToUtcDate,
  firstDayOfMonthMonthsAgo,
  formatClock,
  formatDayNumber,
  formatNoteMoment,
  localDayNumber,
  localDayNumberFromNs,
  mondayIndex,
  monthOfDay,
  type NoteTimestamp,
} from './activity';

function localMs(year: number, month: number, day: number, hour = 12, minute = 0): number {
  return new Date(year, month, day, hour, minute, 0, 0).getTime();
}

function note(path: string, createdMs: number, modifiedMs: number): NoteTimestamp {
  return { path, createdNs: createdMs * 1_000_000, modifiedNs: modifiedMs * 1_000_000 };
}

const TODAY = new Date(2026, 9, 25, 9, 30);

describe('local day numbers', () => {
  it('maps both ends of a local day to the same day number', () => {
    const start = localDayNumber(localMs(2026, 4, 10, 0, 5));
    const end = localDayNumber(localMs(2026, 4, 10, 23, 55));
    const next = localDayNumber(localMs(2026, 4, 11, 0, 5));
    expect(start).toBe(end);
    expect(next - start).toBe(1);
  });

  it('matches the calendar date in every timezone, including DST switches', () => {
    let previous: number | null = null;
    for (let index = 0; index < 365; index += 1) {
      const date = new Date(2026, 0, 1 + index, 0, 30);
      const dayNumber = localDayNumber(date.getTime());
      expect(dayNumber).toBe(
        Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
      );
      expect(localDayNumber(new Date(2026, 0, 1 + index, 23, 30).getTime())).toBe(dayNumber);
      if (previous !== null) expect(dayNumber - previous).toBe(1);
      previous = dayNumber;
    }
  });

  it('reads nanosecond timestamps as local days', () => {
    expect(localDayNumberFromNs(localMs(2026, 0, 2, 23, 0) * 1_000_000))
      .toBe(localDayNumber(localMs(2026, 0, 2, 12, 0)));
  });

  it('starts weeks on Monday', () => {
    expect(mondayIndex(localDayNumber(localMs(2024, 0, 1)))).toBe(0);
    expect(mondayIndex(localDayNumber(localMs(2024, 0, 7)))).toBe(6);
    expect(mondayIndex(localDayNumber(localMs(2026, 9, 25)))).toBe(6);
  });
});

describe('counting notes per day', () => {
  it('counts every note of the same local day', () => {
    const counts = countByDay([
      note('a.md', localMs(2026, 9, 20, 0, 5), localMs(2026, 9, 20, 0, 6)),
      note('b.md', localMs(2026, 9, 20, 23, 55), localMs(2026, 9, 21, 0, 1)),
    ], 'created');
    const day = localDayNumber(localMs(2026, 9, 20, 12, 0));
    expect(counts.get(day)).toBe(2);
    expect(counts.size).toBe(1);
  });

  it('keeps created and modified measures apart', () => {
    const notes = [
      note('a.md', localMs(2026, 9, 20), localMs(2026, 9, 22)),
      note('b.md', localMs(2026, 9, 20), localMs(2026, 9, 20)),
    ];
    const created = countByDay(notes, 'created');
    const modified = countByDay(notes, 'modified');
    const twentieth = localDayNumber(localMs(2026, 9, 20));
    const twentySecond = localDayNumber(localMs(2026, 9, 22));
    expect(created.get(twentieth)).toBe(2);
    expect(created.has(twentySecond)).toBe(false);
    expect(modified.get(twentieth)).toBe(1);
    expect(modified.get(twentySecond)).toBe(1);
  });

  it('ignores notes without a usable timestamp', () => {
    const counts = countByDay([
      { path: 'a.md', createdNs: 0, modifiedNs: 0 },
      { path: 'b.md', createdNs: -5, modifiedNs: Number.NaN },
      note('c.md', localMs(2026, 9, 20), localMs(2026, 9, 20)),
    ], 'created');
    expect([...counts.values()]).toEqual([1]);
  });
});

describe('formatting moments', () => {
  it('writes a day number as a civil ISO date', () => {
    const day = localDayNumber(localMs(2026, 9, 25, 14, 30));
    expect(dayIsoDate(day)).toBe('2026-10-25');
  });

  it('keeps the clock and the moment in the local time of the note', () => {
    const nanos = localMs(2026, 9, 25, 14, 30) * 1_000_000;
    const clock = formatClock(nanos, 'en');
    expect(clock).toMatch(/\d{1,2}[:.]\d{2}/);
    expect(formatNoteMoment(nanos, 'en')).toContain('Oct');
    expect(formatNoteMoment(nanos, 'en').endsWith(clock)).toBe(true);
  });
});

describe('the twelve month grid', () => {
  const grid = buildActivityGrid([
    note('a.md', localMs(2026, 9, 20), localMs(2026, 9, 20)),
    note('b.md', localMs(2026, 9, 20), localMs(2026, 9, 21)),
  ], 'created', TODAY);

  it('starts on the first day of the month eleven months back', () => {
    expect(grid.startDay).toBe(firstDayOfMonthMonthsAgo(TODAY, 11));
    expect(monthOfDay(grid.startDay)).toBe(10);
    expect(grid.endDay).toBe(localDayNumber(TODAY.getTime()));
  });

  it('builds whole Monday-first weeks that cover the range', () => {
    expect(grid.weeks.length).toBeGreaterThan(48);
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true);
    expect(mondayIndex(grid.weeks[0][0].day)).toBe(0);
    expect(mondayIndex(grid.weeks[grid.weeks.length - 1][6].day)).toBe(6);
    expect(grid.weeks[0][0].day).toBeLessThanOrEqual(grid.startDay);
    expect(grid.weeks[grid.weeks.length - 1][6].day).toBeGreaterThanOrEqual(grid.endDay);
  });

  it('keeps empty days with a zero count', () => {
    const days = grid.weeks.flat();
    const inside = days.filter((cell) => cell.inRange);
    expect(inside.length).toBe(grid.endDay - grid.startDay + 1);
    expect(days.filter((cell) => !cell.inRange).every((cell) => cell.count === 0)).toBe(true);
    expect(inside.filter((cell) => cell.count === 0).length).toBe(inside.length - 1);
    expect(grid.totalCount).toBe(2);
    expect(grid.maxCount).toBe(2);
  });

  it('labels the months in order with a readable gap', () => {
    expect(grid.monthLabels[0].week).toBe(0);
    expect(grid.monthLabels.length).toBeGreaterThan(8);
    grid.monthLabels.forEach((label, index) => {
      if (index === 0) return;
      expect(label.week - grid.monthLabels[index - 1].week).toBeGreaterThanOrEqual(3);
      expect(monthOfDay(grid.weeks[label.week][0].day)).toBe(label.month);
    });
  });

  it('grows with the biggest day of the range', () => {
    expect(activityLevel(0, 9)).toBe(0);
    expect(activityLevel(1, 9)).toBe(1);
    expect(activityLevel(3, 9)).toBe(2);
    expect(activityLevel(7, 9)).toBe(4);
    expect(activityLevel(2, 0)).toBe(1);
  });

  it('formats days from the day number alone', () => {
    const day = localDayNumber(localMs(2026, 9, 25));
    expect(dayToUtcDate(day).getUTCDate()).toBe(25);
    expect(formatDayNumber(day, 'en', true)).toContain('2026');
    expect(formatDayNumber(day, 'ru', false)).not.toContain('2026');
  });
});
