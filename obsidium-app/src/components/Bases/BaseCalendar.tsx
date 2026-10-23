import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide';
import { Icon } from '../Common/Icon';
import { t } from '../../i18n';
import { fileName } from '../../modules/paths';
import {
  buildCalendarMonth,
  monthLabel,
  monthOf,
  shiftMonth,
  todayIso,
  weekdayLabels,
  type BaseRow,
  type BaseViewDefinition,
} from '../../modules/bases';

interface BaseCalendarProps {
  rows: readonly BaseRow[];
  view: BaseViewDefinition;
  workspacePath: string;
  onOpen: (path: string) => void;
  onCreateDay: (date: string) => Promise<void>;
}

export function BaseCalendar({ rows, view, workspacePath, onOpen, onCreateDay }: BaseCalendarProps) {
  const [anchor, setAnchor] = useState(() => monthOf(todayIso()) ?? { year: 2026, month: 1 });
  const [creating, setCreating] = useState<string | null>(null);
  const locale = document.documentElement.lang || 'en';
  const month = useMemo(
    () => buildCalendarMonth(rows, view, workspacePath, anchor),
    [rows, view, workspacePath, anchor],
  );
  const weekdays = useMemo(() => weekdayLabels(locale), [locale]);
  const today = todayIso();

  const step = (delta: number) => setAnchor((current) => shiftMonth(current.year, current.month, delta));

  const createOn = async (date: string) => {
    setCreating(date);
    try {
      await onCreateDay(date);
    } finally {
      setCreating(null);
    }
  };

  return (
    <section className="q-base-calendar" aria-label={monthLabel(month.year, month.month, locale)}>
      <header className="q-base-calendar__toolbar">
        <button type="button" onClick={() => step(-1)} aria-label={t('bases.calendarPrevious')}>
          <Icon icon={ChevronLeft} />
        </button>
        <strong className="q-base-calendar__month">{monthLabel(month.year, month.month, locale)}</strong>
        <button type="button" onClick={() => step(1)} aria-label={t('bases.calendarNext')}>
          <Icon icon={ChevronRight} />
        </button>
        <button
          type="button"
          className="q-base-calendar__today"
          onClick={() => {
            const current = monthOf(today);
            if (current) setAnchor(current);
          }}
        >
          {t('bases.calendarToday')}
        </button>
        {month.undated.length > 0 && (
          <span className="q-base-calendar__undated">
            {t('bases.calendarUndated', { count: String(month.undated.length) })}
          </span>
        )}
      </header>

      <div className="q-base-calendar__weekdays" aria-hidden="true">
        {weekdays.map((label) => <span key={label}>{label}</span>)}
      </div>

      <div className="q-base-calendar__grid">
        {month.days.map((day) => (
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
              <span>{day.date ? String(Number(day.date.slice(8, 10))) : ''}</span>
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
        ))}
      </div>
    </section>
  );
}
