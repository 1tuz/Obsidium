// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { t } from '../../../../i18n';
import { monthLabel } from '../../../../modules/calendar/monthGrid';
import type { DataviewCell, DataviewOutput } from '../../../../modules/docs/dataview';
import { DATAVIEW_CLASSES } from './constants';
import { renderDataviewDom } from './widgetDom';

function dateCell(text: string): DataviewCell {
  return { parts: [{ kind: 'text', text }] };
}

function linkCell(target: string, text: string): DataviewCell {
  return { parts: [{ kind: 'link', target, text }] };
}

const CALENDAR: DataviewOutput = {
  shape: 'calendar',
  refreshSeconds: null,
  title: null,
  columns: ['due', 'Заметка', 'status'],
  rows: [
    dateCell('2026-10-07'),
    linkCell('Встреча.md', 'Встреча'),
    dateCell('read'),
    dateCell('2026-10-20'),
    linkCell('Созвон.md', 'Созвон'),
    dateCell('draft'),
    dateCell('когда-нибудь'),
    linkCell('Без даты.md', 'Без даты'),
    dateCell(''),
  ],
  width: 3,
  total: 3,
  truncated: false,
};

function render(output: DataviewOutput = CALENDAR): HTMLElement {
  return renderDataviewDom({ status: 'ready', output });
}

describe('dataview calendar', () => {
  it('lays out a monday-first month grid with a row on its own day', () => {
    const root = render();
    const days = [...root.querySelectorAll(`.${DATAVIEW_CLASSES.calendarDay}`)];
    expect(days).toHaveLength(42);

    const seventh = root.querySelector('[aria-label="2026-10-07"]');
    expect(seventh).not.toBeNull();
    expect(seventh?.querySelector(`.${DATAVIEW_CLASSES.link}`)?.textContent).toBe('Встреча');
    expect(seventh?.querySelector(`.${DATAVIEW_CLASSES.link}`)?.getAttribute('data-target')).toBe('Встреча.md');
    expect(seventh?.textContent).toContain('read');

    const twentieth = root.querySelector('[aria-label="2026-10-20"]');
    expect(twentieth?.querySelector(`.${DATAVIEW_CLASSES.link}`)?.textContent).toBe('Созвон');

    const empty = root.querySelector('[aria-label="2026-10-08"]');
    expect(empty?.querySelector(`.${DATAVIEW_CLASSES.link}`)).toBeNull();
  });

  it('opens on the earliest dated month and counts the rows without a date', () => {
    const root = render();
    expect(root.querySelector(`.${DATAVIEW_CLASSES.calendarMonth}`)?.textContent).toBe('October 2026');
    expect(root.querySelector(`.${DATAVIEW_CLASSES.calendarUndated}`)?.textContent)
      .toBe(t('dataview.calendarUndated', { count: 1 }));
  });

  it('steps between months without touching the undated counter', () => {
    const root = render();
    const toolbar = `.${DATAVIEW_CLASSES.calendarToolbar} button`;
    expect(root.querySelectorAll(toolbar)).toHaveLength(3);

    root.querySelectorAll<HTMLButtonElement>(toolbar)[1].click();
    expect(root.querySelector(`.${DATAVIEW_CLASSES.calendarMonth}`)?.textContent)
      .toBe(monthLabel(2026, 11, 'en'));
    expect(root.querySelector('[aria-label="2026-10-07"]')).toBeNull();
    expect(root.querySelector(`.${DATAVIEW_CLASSES.calendarUndated}`)?.textContent)
      .toBe(t('dataview.calendarUndated', { count: 1 }));

    root.querySelectorAll<HTMLButtonElement>(toolbar)[0].click();
    expect(root.querySelector(`.${DATAVIEW_CLASSES.calendarMonth}`)?.textContent)
      .toBe(monthLabel(2026, 10, 'en'));
    expect(root.querySelector('[aria-label="2026-10-07"]')).not.toBeNull();
  });

  it('keeps the dataview shapes apart', () => {
    const table = render({
      ...CALENDAR,
      shape: 'table',
      columns: ['Заметка'],
      rows: [linkCell('Встреча.md', 'Встреча')],
      width: 1,
      total: 1,
    });
    expect(table.querySelector(`.${DATAVIEW_CLASSES.calendar}`)).toBeNull();
    expect(table.querySelector(`.${DATAVIEW_CLASSES.table}`)).not.toBeNull();
  });
});
