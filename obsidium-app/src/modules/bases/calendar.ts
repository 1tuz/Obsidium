import { noteDateToIso, parseNoteDate } from '../notedate';
import { baseProperty } from './properties';
import type { BaseFieldValue, BaseRow, BaseViewDefinition } from './types';

export interface CalendarDay {
  key: string;
  date: string | null;
  inMonth: boolean;
  rows: BaseRow[];
  hasJournal: boolean;
}

export interface CalendarMonth {
  year: number;
  month: number;
  days: CalendarDay[];
  undated: BaseRow[];
}

const DAYS_IN_GRID = 42;
const NO_JOURNAL_DAYS: ReadonlySet<string> = new Set();

export function calendarProperty(view: BaseViewDefinition): string {
  return view.dateField || 'date';
}

export function calendarDate(value: BaseFieldValue | undefined): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = calendarDate(item);
      if (parsed) return parsed;
    }
    return null;
  }
  if (typeof value !== 'string') return null;
  const date = parseNoteDate(value.trim());
  return date === null ? null : noteDateToIso(date);
}

function isoOf(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10);
}

function mondayOffset(year: number, month: number, day: number): number {
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

export function buildCalendarMonth(
  rows: readonly BaseRow[],
  view: BaseViewDefinition,
  workspacePath: string,
  anchor: { year: number; month: number },
  journalDays: ReadonlySet<string> = NO_JOURNAL_DAYS,
): CalendarMonth {
  const property = calendarProperty(view);
  const buckets = new Map<string, BaseRow[]>();
  const undated: BaseRow[] = [];
  for (const row of rows) {
    const date = calendarDate(baseProperty(row, property, workspacePath));
    if (date === null) {
      undated.push(row);
      continue;
    }
    const bucket = buckets.get(date) ?? [];
    bucket.push(row);
    buckets.set(date, bucket);
  }

  const firstOffset = mondayOffset(anchor.year, anchor.month, 1);
  const start = new Date(Date.UTC(anchor.year, anchor.month - 1, 1 - firstOffset));
  const days: CalendarDay[] = [];
  for (let index = 0; index < DAYS_IN_GRID; index += 1) {
    const date = new Date(start.getTime() + index * 24 * 60 * 60 * 1000);
    const iso = date.toISOString().slice(0, 10);
    days.push({
      key: iso,
      date: iso,
      inMonth: date.getUTCMonth() + 1 === anchor.month && date.getUTCFullYear() === anchor.year,
      rows: buckets.get(iso) ?? [],
      hasJournal: journalDays.has(iso),
    });
  }

  return { year: anchor.year, month: anchor.month, days, undated };
}

export function todayIso(now: Date = new Date()): string {
  return isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function monthLabel(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

export function weekdayLabels(locale: string): string[] {
  const formatter = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, index) => (
    formatter.format(new Date(Date.UTC(2024, 0, 1 + index)))
  ));
}
