import { parseNoteDate } from '../notedate';

export interface GridDay<T> {
  key: string;
  date: string;
  inMonth: boolean;
  rows: T[];
  hasJournal: boolean;
}

export interface MonthGrid<T> {
  year: number;
  month: number;
  days: GridDay<T>[];
  undated: T[];
}

export interface WeekGrid<T> {
  start: string;
  end: string;
  days: GridDay<T>[];
  undated: T[];
}

export const DAYS_IN_GRID = 42;
export const DAYS_IN_WEEK = 7;
export const NO_JOURNAL_DAYS: ReadonlySet<string> = new Set();

const DAY_MS = 24 * 60 * 60 * 1000;

function isoOf(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

export function mondayOffset(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return (weekday + 6) % 7;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zeroBased / 12), month: (zeroBased % 12 + 12) % 12 + 1 };
}

export function monthOf(date: string): { year: number; month: number } | null {
  const parsed = parseNoteDate(date);
  return parsed === null ? null : { year: parsed.year, month: parsed.month };
}

export function todayIso(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function monthLabel(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

export function weekLabel(start: string, end: string, locale: string): string {
  const head = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${start}T00:00:00Z`));
  const tail = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${end}T00:00:00Z`));
  return `${head} – ${tail}`;
}

export function weekdayLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, index) => (
    formatter.format(new Date(Date.UTC(2024, 0, 1 + index)))
  ));
}

export function bucketByDate<T>(
  rows: readonly T[],
  dateOf: (row: T) => string | null,
): { buckets: Map<string, T[]>; undated: T[] } {
  const buckets = new Map<string, T[]>();
  const undated: T[] = [];
  for (const row of rows) {
    const date = dateOf(row);
    if (date === null) {
      undated.push(row);
      continue;
    }
    const bucket = buckets.get(date) ?? [];
    bucket.push(row);
    buckets.set(date, bucket);
  }
  return { buckets, undated };
}

function gridDates(start: Date, count: number): Date[] {
  return Array.from({ length: count }, (_, index) => new Date(start.getTime() + index * DAY_MS));
}

function buildDay<T>(
  date: Date,
  buckets: ReadonlyMap<string, T[]>,
  journalDays: ReadonlySet<string>,
  inMonth: boolean,
): GridDay<T> {
  const iso = date.toISOString().slice(0, 10);
  return {
    key: iso,
    date: iso,
    inMonth,
    rows: buckets.get(iso) ?? [],
    hasJournal: journalDays.has(iso),
  };
}

export function buildMonthGrid<T>(
  rows: readonly T[],
  dateOf: (row: T) => string | null,
  anchor: { year: number; month: number },
  journalDays: ReadonlySet<string> = NO_JOURNAL_DAYS,
): MonthGrid<T> {
  const { buckets, undated } = bucketByDate(rows, dateOf);
  const firstOffset = mondayOffset(anchor.year, anchor.month, 1);
  const start = new Date(Date.UTC(anchor.year, anchor.month - 1, 1 - firstOffset));
  const days = gridDates(start, DAYS_IN_GRID).map((date) => buildDay(
    date,
    buckets,
    journalDays,
    date.getUTCMonth() + 1 === anchor.month && date.getUTCFullYear() === anchor.year,
  ));
  return { year: anchor.year, month: anchor.month, days, undated };
}

export function buildWeekGrid<T>(
  rows: readonly T[],
  dateOf: (row: T) => string | null,
  anchorDate: string,
  journalDays: ReadonlySet<string> = NO_JOURNAL_DAYS,
): WeekGrid<T> | null {
  const parsed = parseNoteDate(anchorDate);
  if (parsed === null) return null;
  const { buckets, undated } = bucketByDate(rows, dateOf);
  const offset = mondayOffset(parsed.year, parsed.month, parsed.day);
  const start = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day - offset));
  const days = gridDates(start, DAYS_IN_WEEK).map((date) => buildDay(
    date,
    buckets,
    journalDays,
    date.getUTCMonth() + 1 === parsed.month && date.getUTCFullYear() === parsed.year,
  ));
  return { start: days[0].key, end: days[DAYS_IN_WEEK - 1].key, days, undated };
}
