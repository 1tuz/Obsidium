import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  timelineDayOffset,
  timelineEndProperty,
  timelineLabel,
  timelineStartProperty,
} from './timeline';
import type { BaseRow, BaseViewDefinition } from './types';

function view(overrides: Partial<BaseViewDefinition> = {}): BaseViewDefinition {
  return { type: 'timeline', name: 'Timeline', order: [], ...overrides };
}

function row(path: string, fields: Record<string, string>): BaseRow {
  return { path, fields };
}

describe('buildTimeline', () => {
  it('normalises the range across a month boundary', () => {
    const rows = [
      row('/vault/alpha.md', { start: '2026-01-28', end: '2026-02-03' }),
      row('/vault/beta.md', { start: '2026-02-01', end: '2026-02-01' }),
    ];
    const layout = buildTimeline(rows, view(), '/vault');
    expect(layout.start).toBe('2026-01-28');
    expect(layout.end).toBe('2026-02-03');
    expect(layout.days).toBe(7);
    expect(layout.months).toEqual([
      { key: '2026-01', year: 2026, month: 1, offset: 0, days: 4 },
      { key: '2026-02', year: 2026, month: 2, offset: 4, days: 3 },
    ]);
    expect(layout.lanes).toEqual([
      {
        row: rows[0],
        start: '2026-01-28',
        end: '2026-02-03',
        offset: 0,
        span: 7,
      },
      {
        row: rows[1],
        start: '2026-02-01',
        end: '2026-02-01',
        offset: 4,
        span: 1,
      },
    ]);
  });

  it('keeps a single-day bar one day wide', () => {
    const rows = [
      row('/vault/alpha.md', { start: '2026-03-04', end: '2026-03-04' }),
      row('/vault/beta.md', { start: '2026-03-09', end: '2026-03-09' }),
    ];
    const layout = buildTimeline(rows, view(), '/vault');
    expect(layout.days).toBe(6);
    expect(layout.lanes.map((lane) => [lane.offset, lane.span])).toEqual([[0, 1], [5, 1]]);
  });

  it('treats a reversed pair as the same span', () => {
    const layout = buildTimeline(
      [row('/vault/alpha.md', { start: '2026-05-10', end: '2026-05-04' })],
      view(),
      '/vault',
    );
    expect(layout.start).toBe('2026-05-04');
    expect(layout.end).toBe('2026-05-10');
    expect(layout.lanes[0]).toMatchObject({ start: '2026-05-04', end: '2026-05-10', offset: 0, span: 7 });
  });

  it('keeps rows with a missing or invalid date in undated', () => {
    const rows = [
      row('/vault/dated.md', { start: '2026-04-01', end: '2026-04-03' }),
      row('/vault/no-end.md', { start: '2026-04-02', end: '' }),
      row('/vault/broken.md', { start: '2026-04-02', end: 'nonsense' }),
      row('/vault/no-start.md', { end: '2026-04-05' }),
      row('/vault/no-dates.md', {}),
    ];
    const layout = buildTimeline(rows, view(), '/vault');
    expect(layout.lanes.map((lane) => lane.row.path)).toEqual(['/vault/dated.md']);
    expect(layout.undated.map((entry) => entry.path)).toEqual([
      '/vault/no-end.md',
      '/vault/broken.md',
      '/vault/no-start.md',
      '/vault/no-dates.md',
    ]);
    expect(layout.start).toBe('2026-04-01');
    expect(layout.end).toBe('2026-04-03');
  });

  it('reports every row as undated when no row has both dates', () => {
    const rows = [
      row('/vault/one.md', { start: '2026-04-01' }),
      row('/vault/two.md', { end: '2026-04-03' }),
    ];
    const layout = buildTimeline(rows, view(), '/vault');
    expect(layout).toEqual({
      start: null,
      end: null,
      days: 0,
      months: [],
      lanes: [],
      undated: rows,
    });
  });

  it('sorts lanes by start, then by end, then by path', () => {
    const rows = [
      row('/vault/late.md', { start: '2026-06-10', end: '2026-06-12' }),
      row('/vault/long.md', { start: '2026-06-01', end: '2026-06-20' }),
      row('/vault/short-b.md', { start: '2026-06-01', end: '2026-06-02' }),
      row('/vault/short-a.md', { start: '2026-06-01', end: '2026-06-02' }),
    ];
    const layout = buildTimeline(rows, view(), '/vault');
    expect(layout.lanes.map((lane) => lane.row.path)).toEqual([
      '/vault/short-a.md',
      '/vault/short-b.md',
      '/vault/long.md',
      '/vault/late.md',
    ]);
  });

  it('reads the configured start and end properties', () => {
    const rows = [
      row('/vault/alpha.md', { start: '2026-07-01', end: '2026-07-02', begin: '2026-08-01', finish: '2026-08-05' }),
    ];
    const layout = buildTimeline(
      rows,
      view({ startField: 'begin', endField: 'finish' }),
      '/vault',
    );
    expect(layout.start).toBe('2026-08-01');
    expect(layout.end).toBe('2026-08-05');
  });

  it('accepts the shared note date grammar and ISO timestamps', () => {
    const layout = buildTimeline(
      [row('/vault/alpha.md', { start: '01.09.2026', end: '2026-09-03T12:00:00Z' })],
      view(),
      '/vault',
    );
    expect(layout.start).toBe('2026-09-01');
    expect(layout.end).toBe('2026-09-03');
    expect(layout.days).toBe(3);
  });
});

describe('timeline properties', () => {
  it('falls back to start and end', () => {
    expect(timelineStartProperty(view())).toBe('start');
    expect(timelineEndProperty(view())).toBe('end');
    expect(timelineStartProperty(view({ startField: 'begin', endField: 'finish' }))).toBe('begin');
    expect(timelineEndProperty(view({ startField: 'begin', endField: 'finish' }))).toBe('finish');
  });
});

describe('timelineDayOffset', () => {
  it('counts whole days between two ISO dates', () => {
    expect(timelineDayOffset('2026-10-25', '2026-10-25')).toBe(0);
    expect(timelineDayOffset('2026-10-25', '2026-11-02')).toBe(8);
    expect(timelineDayOffset('2026-03-01', '2026-02-27')).toBe(-2);
    expect(timelineDayOffset('nonsense', '2026-10-25')).toBeNull();
  });
});

describe('timelineLabel', () => {
  it('labels a range and a single day', () => {
    expect(timelineLabel('2026-10-01', '2026-10-31', 'en')).toContain('–');
    expect(timelineLabel('2026-10-05', '2026-10-05', 'en')).not.toContain('–');
  });
});
