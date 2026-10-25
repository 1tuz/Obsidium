import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide';
import { Icon } from '../Common/Icon';
import { SegmentedControl } from '../Common/SegmentedControl';
import { t } from '../../i18n';
import { noteDateToIso } from '../../modules/notedate';
import { getCalendarEvents, type CalendarEvent } from '../../modules/calendar/gateway';
import { fileName } from '../../modules/paths';
import {
  buildCalendarMonth,
  buildCalendarWeek,
  monthLabel,
  monthOf,
  shiftDay,
  shiftMonthDate,
  todayIso,
  weekLabel,
  weekdayLabels,
  type BaseRow,
  type BaseViewDefinition,
} from '../../modules/bases';

type CalendarMode = 'month' | 'week';

interface BaseCalendarProps {
  rows: readonly BaseRow[];
  view: BaseViewDefinition;
  workspacePath: string;
  journalDays?: ReadonlySet<string>;
  indexRevision?: number;
  onOpen: (path: string) => void;
  onOpenEvent: (path: string, offset: number) => void;
  onOpenJournal?: (date: string) => void;
  onCreateDay: (date: string) => Promise<void>;
  onCreateError?: (error: unknown) => void;
}

export function BaseCalendar({
  rows,
  view,
  workspacePath,
  journalDays,
  indexRevision,
  onOpen,
  onOpenEvent,
  onOpenJournal,
  onCreateDay,
  onCreateError,
}: BaseCalendarProps) {
  const [mode, setMode] = useState<CalendarMode>('month');
  const [anchorDate, setAnchorDate] = useState(() => todayIso());
  const [creating, setCreating] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const locale = document.documentElement.lang || 'en';
  const anchorMonth = useMemo(() => monthOf(anchorDate) ?? { year: 2026, month: 1 }, [anchorDate]);
  const monthView = useMemo(
    () => (mode === 'month' ? buildCalendarMonth(rows, view, workspacePath, anchorMonth, journalDays) : null),
    [mode, rows, view, workspacePath, anchorMonth, journalDays],
  );
  const weekView = useMemo(
    () => (mode === 'week' ? buildCalendarWeek(rows, view, workspacePath, anchorDate, journalDays) : null),
    [mode, rows, view, workspacePath, anchorDate, journalDays],
  );
  const days = monthView?.days ?? weekView?.days ?? [];
  const undatedCount = monthView?.undated.length ?? weekView?.undated.length ?? 0;
  const heading = monthView
    ? monthLabel(monthView.year, monthView.month, locale)
    : weekView
      ? weekLabel(weekView.start, weekView.end, locale)
      : monthLabel(anchorMonth.year, anchorMonth.month, locale);
  const months = useMemo(() => {
    if (monthView) return [{ year: monthView.year, month: monthView.month }];
    if (!weekView) return [];
    const start = monthOf(weekView.start);
    const end = monthOf(weekView.end);
    if (!start || !end) return [];
    return start.year === end.year && start.month === end.month ? [start] : [start, end];
  }, [monthView, weekView]);
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);
  const today = todayIso();

  useEffect(() => {
    let active = true;
    Promise.all(months.map(({ year, month }) => (
      getCalendarEvents(workspacePath, year, month).catch((): CalendarEvent[] => [])
    )))
      .then((result) => {
        if (active) setEvents(result.flat());
      });
    return () => {
      active = false;
    };
  }, [workspacePath, months, indexRevision]);

  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEvent[]>();
    for (const event of events) {
      const bucket = grouped.get(event.date);
      if (bucket) bucket.push(event);
      else grouped.set(event.date, [event]);
    }
    return grouped;
  }, [events]);

  const openEvents = openDate ? eventsByDate.get(openDate) ?? [] : [];
  const panelDate = openEvents.length > 0 ? openDate : null;

  const changeMode = (next: CalendarMode) => {
    if (next === mode) return;
    if (next === 'week') {
      const current = monthOf(today);
      const inside = current !== null && current.year === anchorMonth.year && current.month === anchorMonth.month;
      setAnchorDate(inside ? today : noteDateToIso({ year: anchorMonth.year, month: anchorMonth.month, day: 1 }));
    }
    setMode(next);
  };

  const step = (delta: number) => {
    setAnchorDate((current) => (
      mode === 'week' ? shiftDay(current, delta * 7) : shiftMonthDate(current, delta)
    ) ?? current);
  };

  const createOn = async (date: string) => {
    setCreating(date);
    try {
      await onCreateDay(date);
    } catch (error) {
      onCreateError?.(error);
    } finally {
      setCreating(null);
    }
  };

  return (
    <section className="q-base-calendar" aria-label={heading}>
      <header className="q-base-calendar__toolbar">
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label={t(mode === 'week' ? 'bases.calendarPreviousWeek' : 'bases.calendarPrevious')}
        >
          <Icon icon={ChevronLeft} />
        </button>
        <strong className="q-base-calendar__month">{heading}</strong>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label={t(mode === 'week' ? 'bases.calendarNextWeek' : 'bases.calendarNext')}
        >
          <Icon icon={ChevronRight} />
        </button>
        <button
          type="button"
          className="q-base-calendar__today"
          onClick={() => setAnchorDate(today)}
        >
          {t('bases.calendarToday')}
        </button>
        <SegmentedControl
          options={[
            { value: 'month', label: t('bases.calendarModeMonth') },
            { value: 'week', label: t('bases.calendarModeWeek') },
          ]}
          value={mode}
          onChange={(value) => changeMode(value === 'week' ? 'week' : 'month')}
        />
        {undatedCount > 0 && (
          <span className="q-base-calendar__undated">
            {t('bases.calendarUndated', { count: String(undatedCount) })}
          </span>
        )}
      </header>

      <div className="q-base-calendar__weekdays" aria-hidden="true">
        {weekdays.map((label) => <span key={label}>{label}</span>)}
      </div>

      <div className="q-base-calendar__grid">
        {days.map((day) => {
          const dayEvents = day.date ? eventsByDate.get(day.date) ?? [] : [];
          return (
            <div
              key={day.key}
              className={[
                'q-base-calendar__day',
                day.inMonth ? '' : 'q-base-calendar__day--outside',
                day.date === today ? 'q-base-calendar__day--today' : '',
              ].filter(Boolean).join(' ')}
              role="group"
              aria-label={day.date ?? day.key}
            >
              <div className="q-base-calendar__day-head">
                {day.date && dayEvents.length > 0 ? (
                  <button
                    type="button"
                    className="q-base-calendar__day-number"
                    aria-label={t('bases.calendarEvents', { date: day.date, count: String(dayEvents.length) })}
                    onClick={() => setOpenDate(day.date)}
                  >
                    {Number(day.date.slice(8, 10))}
                  </button>
                ) : (
                  <span>{day.date ? String(Number(day.date.slice(8, 10))) : ''}</span>
                )}
                <span className="q-base-calendar__day-actions">
                  {day.date && dayEvents.length > 0 && (
                    <span
                      className="q-base-calendar__events"
                      title={t('bases.calendarEvents', { date: day.date, count: String(dayEvents.length) })}
                    >
                      {dayEvents.length}
                    </span>
                  )}
                  {day.hasJournal && (
                    <button
                      type="button"
                      className="q-base-calendar__journal"
                      aria-label={t('bases.calendarJournal', { date: day.date ?? day.key })}
                      title={t('bases.calendarJournal', { date: day.date ?? day.key })}
                      onClick={() => onOpenJournal?.(day.date ?? day.key)}
                    />
                  )}
                  {day.date && (
                    <button
                      type="button"
                      className="q-base-calendar__add"
                      aria-label={t('bases.calendarAdd', { date: day.date })}
                      disabled={creating === day.date}
                      onClick={() => void createOn(day.date!)}
                    >
                      <Icon icon={Plus} />
                    </button>
                  )}
                </span>
              </div>
              <div className="q-base-calendar__entries">
                {day.rows.map((row) => (
                  <button
                    key={row.path}
                    type="button"
                    className="q-base-calendar__entry"
                    onClick={() => onOpen(row.path)}
                    title={row.path}
                  >
                    {fileName(row.path).replace(/\.md$/i, '')}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {panelDate && (
        <div className="q-base-calendar__events-panel" role="dialog" aria-label={t('bases.calendarEventsTitle', { date: panelDate })}>
          <header className="q-base-calendar__events-head">
            <strong>{t('bases.calendarEventsTitle', { date: panelDate })}</strong>
            <button
              type="button"
              className="q-base-calendar__events-close"
              aria-label={t('bases.calendarEventsClose')}
              title={t('bases.calendarEventsClose')}
              onClick={() => setOpenDate(null)}
            >
              <Icon icon={X} />
            </button>
          </header>
          <div className="q-base-calendar__events-list">
            {openEvents.map((event) => (
              <button
                key={`${event.path}:${event.byteOffset}`}
                type="button"
                className="q-base-calendar__event"
                onClick={() => onOpenEvent(event.path, event.byteOffset)}
              >
                <span className="q-base-calendar__event-time">{event.time ?? ''}</span>
                <span className="q-base-calendar__event-title">{event.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
