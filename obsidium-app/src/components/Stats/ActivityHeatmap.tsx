import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatNumber, getLocale, plural, t } from '../../i18n';
import { SegmentedControl } from '../Common/SegmentedControl';
import {
  activityLevel,
  buildActivityGrid,
  formatDayNumber,
  loadNoteTimestamps,
  mondayIndex,
  monthLabel,
  weekdayLabel,
  type ActivityDay,
  type ActivityMeasure,
  type NoteTimestamp,
} from '../../modules/stats';
import './ActivityHeatmap.css';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; timestamps: NoteTimestamp[] }
  | { status: 'failed'; reason: string };

export interface ActivityHeatmapProps {
  workspacePath: string | null;
  measure?: ActivityMeasure;
  onMeasureChange?: (measure: ActivityMeasure) => void;
  className?: string;
}

const MEASURES: ActivityMeasure[] = ['created', 'modified'];
const WEEKDAY_ROWS = [0, 2, 4];
const LEVELS = [0, 1, 2, 3, 4];
const NO_TIMESTAMPS: NoteTimestamp[] = [];

export function ActivityHeatmap({
  workspacePath,
  measure: controlledMeasure,
  onMeasureChange,
  className = '',
}: ActivityHeatmapProps) {
  const [ownMeasure, setOwnMeasure] = useState<ActivityMeasure>('created');
  const measure = controlledMeasure ?? ownMeasure;
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  useEffect(() => {
    if (!workspacePath) {
      setState({ status: 'ready', timestamps: [] });
      return;
    }
    let active = true;
    setState({ status: 'loading' });
    loadNoteTimestamps(workspacePath)
      .then((timestamps) => {
        if (active) setState({ status: 'ready', timestamps });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState({
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      active = false;
    };
  }, [workspacePath]);

  const timestamps = state.status === 'ready' ? state.timestamps : NO_TIMESTAMPS;
  const grid = useMemo(
    () => buildActivityGrid(timestamps, measure, new Date()),
    [timestamps, measure],
  );
  const locale = getLocale();

  const labelFor = (cell: ActivityDay) => t('stats.activity.dayAria', {
    date: formatDayNumber(cell.day, locale, true),
    notes: plural('stats.activity.notes', cell.count),
  });

  const selected = selectedDay === null
    ? null
    : grid.weeks.flat().find((cell) => cell.day === selectedDay) ?? null;

  if (!workspacePath) return null;

  return (
    <section className={`q-activity-heatmap ${className}`.trim()} aria-label={t('stats.activity.title')}>
      <header className="q-activity-heatmap__header">
        <h2 className="q-activity-heatmap__title">{t('stats.activity.title')}</h2>
        <SegmentedControl
          options={MEASURES.map((value) => ({ value, label: t(`stats.activity.${value}`) }))}
          value={measure}
          onChange={(next) => {
            const value: ActivityMeasure = next === 'modified' ? 'modified' : 'created';
            if (controlledMeasure === undefined) setOwnMeasure(value);
            onMeasureChange?.(value);
          }}
        />
      </header>
      {state.status === 'loading' && (
        <p className="q-activity-heatmap__status">{t('stats.activity.loading')}</p>
      )}
      {state.status === 'failed' && (
        <p className="q-activity-heatmap__status" role="alert">
          {t('stats.activity.failed', { reason: state.reason })}
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <div
            className="q-activity-heatmap__plot"
            style={{ gridTemplateColumns: `auto repeat(${grid.weeks.length}, var(--q-size-12))` }}
            role="group"
            aria-label={t('stats.activity.gridLabel')}
          >
            {grid.monthLabels.map((label) => (
              <span
                key={`month-${label.week}`}
                className="q-activity-heatmap__month"
                style={{ gridRow: '1', gridColumn: String(label.week + 2) }}
                aria-hidden="true"
              >
                {monthLabel(label.month, locale)}
              </span>
            ))}
            {WEEKDAY_ROWS.map((offset) => (
              <span
                key={`weekday-${offset}`}
                className="q-activity-heatmap__weekday"
                style={{ gridRow: String(offset + 2), gridColumn: '1' }}
                aria-hidden="true"
              >
                {weekdayLabel(offset, locale)}
              </span>
            ))}
            {grid.weeks.map((week, weekIndex) => week.map((cell) => {
              const row = String(mondayIndex(cell.day) + 2);
              const column = String(weekIndex + 2);
              if (!cell.inRange) {
                return (
                  <span
                    key={`pad-${cell.day}`}
                    className="q-activity-heatmap__day"
                    style={{ gridRow: row, gridColumn: column }}
                    aria-hidden="true"
                  />
                );
              }
              const label = labelFor(cell);
              return (
                <button
                  key={cell.day}
                  type="button"
                  className="q-activity-heatmap__day"
                  style={{ gridRow: row, gridColumn: column }}
                  data-level={activityLevel(cell.count, grid.maxCount)}
                  aria-pressed={selectedDay === cell.day}
                  aria-label={label}
                  title={label}
                  onClick={() => setSelectedDay(cell.day)}
                />
              );
            }))}
          </div>
          <p className="q-activity-heatmap__readout" aria-live="polite">
            {selected ? labelFor(selected) : t('stats.activity.hint')}
          </p>
          <footer className="q-activity-heatmap__footer">
            <span className="q-activity-heatmap__total">
              {grid.totalCount === 0
                ? t('stats.activity.empty')
                : t('stats.activity.total', { count: formatNumber(grid.totalCount) })}
            </span>
            <span className="q-activity-heatmap__legend" aria-hidden="true">
              <span>{t('stats.activity.less')}</span>
              {LEVELS.map((level) => (
                <span key={level} className="q-activity-heatmap__day" data-level={level} />
              ))}
              <span>{t('stats.activity.more')}</span>
            </span>
          </footer>
        </>
      )}
    </section>
  );
}
