import { Fragment, useMemo } from 'react';
import { t } from '../../i18n';
import { fileName } from '../../modules/paths';
import { monthLabel, todayIso, type BaseRow, type BaseViewDefinition } from '../../modules/bases';
import { buildTimeline, timelineDayOffset, timelineLabel } from '../../modules/bases/timeline';

interface BaseTimelineProps {
  rows: readonly BaseRow[];
  view: BaseViewDefinition;
  workspacePath: string;
  onOpen: (path: string) => void;
}

export function BaseTimeline({ rows, view, workspacePath, onOpen }: BaseTimelineProps) {
  const layout = useMemo(() => buildTimeline(rows, view, workspacePath), [rows, view, workspacePath]);
  const locale = document.documentElement.lang || 'en';
  const today = todayIso();
  const todayOffset = layout.start === null ? null : timelineDayOffset(layout.start, today);
  const inRange = todayOffset !== null && todayOffset >= 0 && todayOffset < layout.days;
  const percent = (value: number) => `${(value / Math.max(layout.days, 1)) * 100}%`;
  const heading = layout.start && layout.end
    ? timelineLabel(layout.start, layout.end, locale)
    : t('bases.timelineEmpty');

  return (
    <section className="q-base-timeline" aria-label={heading}>
      <header className="q-base-timeline__toolbar">
        {layout.start && layout.end && (
          <strong className="q-base-timeline__range">{heading}</strong>
        )}
        {layout.undated.length > 0 && (
          <span className="q-base-timeline__undated">
            {t('bases.timelineUndated', { count: String(layout.undated.length) })}
          </span>
        )}
      </header>

      {layout.lanes.length === 0 ? (
        <div className="q-base-state">{t('bases.timelineEmpty')}</div>
      ) : (
        <div className="q-base-timeline__grid">
          <div className="q-base-timeline__scale">
            {layout.months.map((month) => (
              <span
                key={month.key}
                className="q-base-timeline__month"
                style={{ flexGrow: month.days }}
              >
                {monthLabel(month.year, month.month, locale)}
              </span>
            ))}
            {inRange && (
              <span
                className="q-base-timeline__today-label"
                style={{ left: percent(todayOffset) }}
              >
                {t('bases.calendarToday')}
              </span>
            )}
          </div>
          {layout.lanes.map((lane) => {
            const title = fileName(lane.row.path).replace(/\.md$/i, '');
            return (
              <Fragment key={lane.row.path}>
                <span className="q-base-timeline__lane-title" title={lane.row.path}>{title}</span>
                <div className="q-base-timeline__track">
                  {inRange && (
                    <span
                      className="q-base-timeline__today"
                      style={{ left: percent(todayOffset) }}
                      aria-hidden="true"
                    />
                  )}
                  <button
                    type="button"
                    className="q-base-timeline__bar"
                    style={{ left: percent(lane.offset), width: percent(lane.span) }}
                    title={`${title}: ${lane.start} – ${lane.end}`}
                    aria-label={t('bases.timelineBar', { name: title, start: lane.start, end: lane.end })}
                    onClick={() => onOpen(lane.row.path)}
                  >
                    <span>{title}</span>
                  </button>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}
    </section>
  );
}
