import { createTaskCheckbox, TASK_CHECKBOX_CLASS } from '../../../Common/taskCheckbox';
import { t } from '../../../../i18n';
import { noteDateToIso, parseNoteDate } from '../../../../modules/notedate';
import {
  buildMonthGrid,
  monthLabel,
  monthOf,
  shiftMonth,
  todayIso,
  weekdayLabels,
} from '../../../../modules/calendar/monthGrid';
import type { DataviewCell, DataviewOutput } from '../../../../modules/docs/dataview';
import { DATAVIEW_CLASSES, DATAVIEW_MESSAGES, UNKNOWN_HEIGHT } from './constants';
import type { DataviewResult } from './store';

export function renderDataviewDom(
  result: DataviewResult | undefined,
  knownHeight = UNKNOWN_HEIGHT,
): HTMLElement {
  const root = document.createElement('div');
  root.className = DATAVIEW_CLASSES.root;
  root.contentEditable = 'false';

  const card = document.createElement('div');
  card.className = DATAVIEW_CLASSES.card;
  root.append(card);

  if (!result) {
    card.classList.add(DATAVIEW_CLASSES.pending);
    if (knownHeight > 0) card.style.minHeight = `${knownHeight}px`;
    return root;
  }
  if (result.status === 'failed') {
    card.classList.add(DATAVIEW_CLASSES.failed);
    card.append(message(result.message));
    return root;
  }
  const { output } = result;
  if (output.title) {
    card.append(heading(output.title, output.shape));
  }
  if (output.total === 0) {
    card.append(message(DATAVIEW_MESSAGES.empty));
    return root;
  }

  card.append(shapeOutput(output));
  if (output.truncated) {
    card.append(message(DATAVIEW_MESSAGES.truncated(output.rows.length, output.total)));
  }
  return root;
}

function shapeOutput(output: DataviewOutput): HTMLElement {
  if (output.shape === 'table') return table(output);
  if (output.shape === 'calendar') return calendar(output);
  return list(output, output.shape === 'tasks');
}

function heading(text: string, shape: DataviewOutput['shape']): HTMLElement {
  const element = document.createElement('div');
  element.className = DATAVIEW_CLASSES.title;
  if (shape === 'table') element.classList.add(DATAVIEW_CLASSES.titleCells);
  element.textContent = text;
  return element;
}

function table(output: DataviewOutput): HTMLElement {
  const element = document.createElement('table');
  element.className = DATAVIEW_CLASSES.table;

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const title of output.columns) {
    const cell = document.createElement('th');
    cell.textContent = title;
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement('tbody');
  const width = Math.max(output.width, 1);
  for (let start = 0; start < output.rows.length; start += width) {
    const row = document.createElement('tr');
    for (let column = 0; column < width; column += 1) {
      const cell = document.createElement('td');
      fillCell(cell, output.rows[start + column]);
      row.append(cell);
    }
    body.append(row);
  }

  element.append(head, body);
  return element;
}

function list(output: DataviewOutput, tasks = false): HTMLElement {
  const element = document.createElement('ul');
  element.className = tasks ? DATAVIEW_CLASSES.tasks : DATAVIEW_CLASSES.list;
  for (const cell of output.rows) {
    const item = document.createElement('li');
    fillCell(item, cell);
    element.append(item);
  }
  return element;
}

interface CalendarRecord {
  date: string | null;
  label: string;
  target: string | null;
  details: string;
}

function calendar(output: DataviewOutput): HTMLElement {
  const element = document.createElement('div');
  element.className = DATAVIEW_CLASSES.calendar;
  const records = calendarRecords(output);
  const locale = document.documentElement.lang || 'en';
  const today = todayIso();
  let anchor = firstMonth(records) ?? monthOf(today) ?? { year: 2026, month: 1 };
  const undated = records.filter((record) => record.date === null).length;

  const render = () => {
    const grid = buildMonthGrid(records, (record) => record.date, anchor);
    const toolbar = document.createElement('div');
    toolbar.className = DATAVIEW_CLASSES.calendarToolbar;
    toolbar.append(
      calendarStep(t('dataview.calendarPrevious'), '‹', () => {
        anchor = shiftMonth(anchor.year, anchor.month, -1);
        render();
      }),
      calendarHeading(monthLabel(anchor.year, anchor.month, locale)),
      calendarStep(t('dataview.calendarNext'), '›', () => {
        anchor = shiftMonth(anchor.year, anchor.month, 1);
        render();
      }),
      calendarStep(t('dataview.calendarToday'), t('dataview.calendarToday'), () => {
        anchor = monthOf(today) ?? anchor;
        render();
      }),
    );
    if (undated > 0) {
      const counter = document.createElement('span');
      counter.className = DATAVIEW_CLASSES.calendarUndated;
      counter.textContent = t('dataview.calendarUndated', { count: undated });
      toolbar.append(counter);
    }

    const weekdays = document.createElement('div');
    weekdays.className = DATAVIEW_CLASSES.calendarWeekdays;
    weekdays.setAttribute('aria-hidden', 'true');
    for (const label of weekdayLabels(locale)) {
      const weekday = document.createElement('span');
      weekday.textContent = label;
      weekdays.append(weekday);
    }

    const month = document.createElement('div');
    month.className = DATAVIEW_CLASSES.calendarGrid;
    for (const day of grid.days) {
      const cell = document.createElement('div');
      cell.className = [
        DATAVIEW_CLASSES.calendarDay,
        day.inMonth ? '' : DATAVIEW_CLASSES.calendarOutside,
        day.date === today ? DATAVIEW_CLASSES.calendarToday : '',
      ].filter(Boolean).join(' ');
      cell.setAttribute('role', 'group');
      cell.setAttribute('aria-label', day.date);

      const head = document.createElement('div');
      head.className = DATAVIEW_CLASSES.calendarDayHead;
      head.textContent = String(Number(day.date.slice(8, 10)));
      cell.append(head);

      const entries = document.createElement('div');
      entries.className = DATAVIEW_CLASSES.calendarEntries;
      for (const record of day.rows) entries.append(calendarEntry(record));
      cell.append(entries);
      month.append(cell);
    }

    element.replaceChildren(toolbar, weekdays, month);
  };

  render();
  return element;
}

function calendarRecords(output: DataviewOutput): CalendarRecord[] {
  const width = Math.max(output.width, 1);
  const records: CalendarRecord[] = [];
  for (let start = 0; start < output.rows.length; start += width) {
    const cells = output.rows.slice(start, start + width);
    const parsed = parseNoteDate(cellText(cells[0]).trim());
    const link = calendarLink(cells[1]);
    records.push({
      date: parsed === null ? null : noteDateToIso(parsed),
      label: link?.text ?? cellText(cells[1]),
      target: link?.target ?? null,
      details: cells.slice(2).map(cellText).filter((text) => text.length > 0).join(' · '),
    });
  }
  return records;
}

function firstMonth(records: readonly CalendarRecord[]): { year: number; month: number } | null {
  let earliest: string | null = null;
  for (const record of records) {
    if (record.date !== null && (earliest === null || record.date < earliest)) earliest = record.date;
  }
  return earliest === null ? null : monthOf(earliest);
}

function calendarLink(cell: DataviewCell | undefined): { target: string; text: string } | null {
  for (const part of cell?.parts ?? []) {
    if (part.kind === 'link') return part;
  }
  return null;
}

function cellText(cell: DataviewCell | undefined): string {
  return (cell?.parts ?? []).map((part) => {
    if (part.kind === 'progress') return `${part.percent}%`;
    if (part.kind === 'check') return part.done ? '✓' : '☐';
    return part.text;
  }).join('');
}

function calendarStep(label: string, text: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

function calendarHeading(text: string): HTMLElement {
  const element = document.createElement('strong');
  element.className = DATAVIEW_CLASSES.calendarMonth;
  element.textContent = text;
  return element;
}

function calendarEntry(record: CalendarRecord): HTMLElement {
  const entry = document.createElement('div');
  entry.className = DATAVIEW_CLASSES.calendarEntry;
  if (record.target) {
    const link = document.createElement('span');
    link.className = DATAVIEW_CLASSES.link;
    link.dataset.target = record.target;
    link.textContent = record.label;
    entry.append(link);
  } else {
    entry.append(document.createTextNode(record.label));
  }
  if (record.details) {
    const meta = document.createElement('span');
    meta.className = DATAVIEW_CLASSES.calendarMeta;
    meta.textContent = record.details;
    entry.append(meta);
  }
  return entry;
}

function fillCell(target: HTMLElement, cell: DataviewCell | undefined): void {
  if (!cell) return;
  for (const part of cell.parts) {
    if (part.kind === 'check') {
      target.append(checkbox(part.done, part.target, part.line));
      continue;
    }
    if (part.kind === 'progress') {
      target.classList.add(DATAVIEW_CLASSES.cellBar);
      target.append(progress(part.percent));
      continue;
    }
    if (part.kind === 'link') {
      const link = document.createElement('span');
      link.className = DATAVIEW_CLASSES.link;
      link.dataset.target = part.target;
      link.textContent = part.text;
      target.append(link);
      continue;
    }
    target.append(document.createTextNode(part.text));
  }
}

function checkbox(done: boolean, target: string, line: number): HTMLElement {
  const box = createTaskCheckbox(done);
  box.dataset.taskTarget = target;
  box.dataset.taskLine = String(line);
  return box;
}

export function dataviewTaskAt(node: EventTarget | null): { target: string; line: number } | null {
  const element = (node as HTMLElement | null)?.closest?.(`.${TASK_CHECKBOX_CLASS}`) as HTMLElement | null;
  const target = element?.dataset.taskTarget;
  const line = Number(element?.dataset.taskLine);
  return target && Number.isFinite(line) ? { target, line } : null;
}

function progress(percent: number): HTMLElement {
  const track = document.createElement('div');
  track.className = DATAVIEW_CLASSES.bar;
  const filled = document.createElement('div');
  filled.className = DATAVIEW_CLASSES.barFill;
  filled.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  track.append(filled);
  return track;
}

function message(text: string): HTMLElement {
  const element = document.createElement('div');
  element.className = DATAVIEW_CLASSES.message;
  element.textContent = text;
  return element;
}

export function dataviewLinkTarget(node: EventTarget | null): string | null {
  const element = (node as HTMLElement | null)?.closest?.(`.${DATAVIEW_CLASSES.link}`);
  return (element as HTMLElement | null)?.dataset.target ?? null;
}
