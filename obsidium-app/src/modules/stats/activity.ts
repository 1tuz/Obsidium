export type ActivityMeasure = 'created' | 'modified';

export interface NoteTimestamp {
  path: string;
  createdNs: number;
  modifiedNs: number;
}

export interface ActivityDay {
  day: number;
  count: number;
  inRange: boolean;
}

export interface ActivityMonthLabel {
  week: number;
  month: number;
}

export interface ActivityGrid {
  measure: ActivityMeasure;
  weeks: ActivityDay[][];
  monthLabels: ActivityMonthLabel[];
  startDay: number;
  endDay: number;
  maxCount: number;
  totalCount: number;
}

export interface ActivityNote {
  path: string;
  timestampNs: number;
}

export const DAY_MS = 86_400_000;
export const NANOS_PER_MILLI = 1_000_000;
export const WEEK_LENGTH = 7;
export const HEATMAP_MONTHS = 12;
export const MONTH_LABEL_GAP = 3;

export function localDayNumber(epochMs: number): number {
  const date = new Date(epochMs);
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS,
  );
}

export function localDayNumberFromNs(nanos: number): number {
  return localDayNumber(Math.floor(nanos / NANOS_PER_MILLI));
}

export function dayToUtcDate(day: number): Date {
  return new Date(day * DAY_MS);
}

export function monthOfDay(day: number): number {
  return dayToUtcDate(day).getUTCMonth();
}

export function mondayIndex(day: number): number {
  return ((day + 3) % WEEK_LENGTH + WEEK_LENGTH) % WEEK_LENGTH;
}

export function firstDayOfMonthMonthsAgo(today: Date, monthsBack: number): number {
  return localDayNumber(
    new Date(today.getFullYear(), today.getMonth() - monthsBack, 1).getTime(),
  );
}

export function countByDay(
  timestamps: readonly NoteTimestamp[],
  measure: ActivityMeasure,
): Map<number, number> {
  const counts = new Map<number, number>();
  for (const note of timestamps) {
    const nanos = measure === 'created' ? note.createdNs : note.modifiedNs;
    if (!Number.isFinite(nanos) || nanos <= 0) continue;
    const day = localDayNumberFromNs(nanos);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

export function activityLevel(count: number, maxCount: number): number {
  if (count <= 0) return 0;
  if (maxCount <= 0) return 1;
  return Math.min(4, Math.max(1, Math.ceil((count / maxCount) * 4)));
}

export function buildActivityGrid(
  timestamps: readonly NoteTimestamp[],
  measure: ActivityMeasure,
  today: Date = new Date(),
): ActivityGrid {
  const counts = countByDay(timestamps, measure);
  const endDay = localDayNumber(today.getTime());
  const startDay = firstDayOfMonthMonthsAgo(today, HEATMAP_MONTHS - 1);
  const gridStart = startDay - mondayIndex(startDay);
  const gridEnd = endDay + (WEEK_LENGTH - 1 - mondayIndex(endDay));

  const weeks: ActivityDay[][] = [];
  let maxCount = 0;
  let totalCount = 0;
  for (let day = gridStart; day <= gridEnd; day += 1) {
    const inRange = day >= startDay && day <= endDay;
    const count = inRange ? counts.get(day) ?? 0 : 0;
    if (inRange) {
      totalCount += count;
      if (count > maxCount) maxCount = count;
    }
    if (weeks.length === 0 || weeks[weeks.length - 1].length === WEEK_LENGTH) {
      weeks.push([]);
    }
    weeks[weeks.length - 1].push({ day, count, inRange });
  }

  return {
    measure,
    weeks,
    monthLabels: monthLabelsFor(weeks),
    startDay,
    endDay,
    maxCount,
    totalCount,
  };
}

function monthLabelsFor(weeks: ActivityDay[][]): ActivityMonthLabel[] {
  const labels: ActivityMonthLabel[] = [];
  let lastWeek = -MONTH_LABEL_GAP;
  let previousMonth: number | null = null;
  weeks.forEach((week, index) => {
    const month = monthOfDay(week[0].day);
    if (month === previousMonth) return;
    previousMonth = month;
    if (index - lastWeek < MONTH_LABEL_GAP) return;
    lastWeek = index;
    labels.push({ week: index, month });
  });
  return labels;
}

export function formatDayNumber(day: number, locale: string, withYear = false): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(dayToUtcDate(day));
}

export function weekdayLabel(mondayOffset: number, locale: string): string {
  const monday = dayToUtcDate(localDayNumber(Date.UTC(2024, 0, 1)));
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(monday.getTime() + mondayOffset * DAY_MS));
}

export function monthLabel(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2024, month, 1)));
}

export function dayIsoDate(day: number): string {
  return dayToUtcDate(day).toISOString().slice(0, 10);
}

export function formatClock(nanos: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Math.floor(nanos / NANOS_PER_MILLI)));
}

export function formatNoteMoment(nanos: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(Math.floor(nanos / NANOS_PER_MILLI)));
}
