import { parseNoteDate } from '../notedate';
import { calendarDate } from './calendar';
import { baseProperty } from './properties';
import type { BaseRow, BaseViewDefinition } from './types';

export interface TimelineLane {
  row: BaseRow;
  start: string;
  end: string;
  offset: number;
  span: number;
}

export interface TimelineMonth {
  key: string;
  year: number;
  month: number;
  offset: number;
  days: number;
}

export interface TimelineLayout {
  start: string | null;
  end: string | null;
  days: number;
  months: TimelineMonth[];
  lanes: TimelineLane[];
  undated: BaseRow[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function timelineStartProperty(view: BaseViewDefinition): string {
  return view.startField || 'start';
}

export function timelineEndProperty(view: BaseViewDefinition): string {
  return view.endField || 'end';
}

function dayNumber(date: string): number | null {
  const parsed = parseNoteDate(date);
  if (parsed === null) return null;
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day) / DAY_MS;
}

function isoFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function timelineDayOffset(start: string, date: string): number | null {
  const from = dayNumber(start);
  const to = dayNumber(date);
  if (from === null || to === null) return null;
  return to - from;
}

export function buildTimeline(
  rows: readonly BaseRow[],
  view: BaseViewDefinition,
  workspacePath: string,
): TimelineLayout {
  const startProperty = timelineStartProperty(view);
  const endProperty = timelineEndProperty(view);
  const undated: BaseRow[] = [];
  const placed: { row: BaseRow; start: number; end: number }[] = [];
  for (const row of rows) {
    const start = calendarDate(baseProperty(row, startProperty, workspacePath));
    const end = calendarDate(baseProperty(row, endProperty, workspacePath));
    const startDay = start === null ? null : dayNumber(start);
    const endDay = end === null ? null : dayNumber(end);
    if (startDay === null || endDay === null) {
      undated.push(row);
      continue;
    }
    placed.push({
      row,
      start: Math.min(startDay, endDay),
      end: Math.max(startDay, endDay),
    });
  }
  placed.sort((left, right) => (
    left.start - right.start
    || left.end - right.end
    || left.row.path.localeCompare(right.row.path)
  ));
  if (placed.length === 0) {
    return { start: null, end: null, days: 0, months: [], lanes: [], undated };
  }
  const first = placed[0].start;
  const last = placed.reduce((max, entry) => Math.max(max, entry.end), first);
  const days = last - first + 1;
  const lanes: TimelineLane[] = placed.map((entry) => ({
    row: entry.row,
    start: isoFromDay(entry.start),
    end: isoFromDay(entry.end),
    offset: entry.start - first,
    span: entry.end - entry.start + 1,
  }));
  const months: TimelineMonth[] = [];
  let cursor = first;
  while (cursor <= last) {
    const date = new Date(cursor * DAY_MS);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    const monthEnd = Date.UTC(year, month, 1) / DAY_MS - 1;
    const end = Math.min(last, monthEnd);
    months.push({
      key: `${year}-${String(month).padStart(2, '0')}`,
      year,
      month,
      offset: cursor - first,
      days: end - cursor + 1,
    });
    cursor = end + 1;
  }
  return { start: isoFromDay(first), end: isoFromDay(last), days, months, lanes, undated };
}

export function timelineLabel(start: string, end: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const head = formatter.format(new Date(`${start}T00:00:00Z`));
  if (start === end) return head;
  const tail = formatter.format(new Date(`${end}T00:00:00Z`));
  return `${head} – ${tail}`;
}
