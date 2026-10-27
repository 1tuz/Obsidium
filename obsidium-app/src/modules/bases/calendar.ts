import { noteDateToIso, parseNoteDate } from '../notedate';
import {
  buildMonthGrid,
  buildWeekGrid,
  shiftMonth,
  type GridDay,
  type MonthGrid,
  type WeekGrid,
} from '../calendar/monthGrid';
import { baseProperty } from './properties';
import { parseBase, serializeBase } from './baseFormat';
import type { BaseFieldValue, BaseRow, BaseViewDefinition } from './types';

export function buildCalendarBase(name: string): string {
  const definition = parseBase('');
  definition.views = [{ type: 'calendar', name, dateField: 'date', order: [] }];
  return serializeBase(definition);
}

export type CalendarDay = GridDay<BaseRow>;
export type CalendarMonth = MonthGrid<BaseRow>;
export type CalendarWeek = WeekGrid<BaseRow>;

export {
  monthLabel,
  monthOf,
  shiftMonth,
  todayIso,
  weekLabel,
  weekdayLabels,
} from '../calendar/monthGrid';

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

function dateOf(view: BaseViewDefinition, workspacePath: string): (row: BaseRow) => string | null {
  const property = calendarProperty(view);
  return (row) => calendarDate(baseProperty(row, property, workspacePath));
}

export function buildCalendarMonth(
  rows: readonly BaseRow[],
  view: BaseViewDefinition,
  workspacePath: string,
  anchor: { year: number; month: number },
  journalDays?: ReadonlySet<string>,
): CalendarMonth {
  return buildMonthGrid(rows, dateOf(view, workspacePath), anchor, journalDays);
}

export function buildCalendarWeek(
  rows: readonly BaseRow[],
  view: BaseViewDefinition,
  workspacePath: string,
  anchorDate: string,
  journalDays?: ReadonlySet<string>,
): CalendarWeek | null {
  return buildWeekGrid(rows, dateOf(view, workspacePath), anchorDate, journalDays);
}

export function shiftDay(date: string, delta: number): string | null {
  const parsed = parseNoteDate(date);
  if (parsed === null) return null;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + delta)).toISOString().slice(0, 10);
}

export function shiftMonthDate(date: string, delta: number): string | null {
  const parsed = parseNoteDate(date);
  if (parsed === null) return null;
  const target = shiftMonth(parsed.year, parsed.month, delta);
  const lastDay = new Date(Date.UTC(target.year, target.month, 0)).getUTCDate();
  return noteDateToIso({ year: target.year, month: target.month, day: Math.min(parsed.day, lastDay) });
}
