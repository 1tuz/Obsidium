import { describe, expect, it } from 'vitest';
import { DateFilter } from './dateFilter';
import { approachStep, FADE_SECONDS, SETTLED_FADE } from './easing';
import { NODE_TEXTURE_WIDTH, nodeTextureRows } from './nodeMetrics';

const FRAME = 1 / 60;

function filterOver(days: number[], createdFrom = Number.NEGATIVE_INFINITY) {
  const filter = new DateFilter();
  const createdDays = new Float32Array(days);
  filter.adopt(createdDays, days.length, nodeTextureRows(days.length), createdFrom);
  return { filter, createdDays };
}

function settle(filter: DateFilter): number {
  let frames = 0;
  while (filter.advance(FRAME) && frames < 600) frames += 1;
  return frames;
}

describe('DateFilter', () => {
  it('shows everything at full strength when no threshold is set', () => {
    const { filter } = filterOver([10, 20, 30]);

    expect(filter.visible).toBe(3);
    expect([...filter.data.subarray(0, 3)]).toEqual([255, 255, 255]);
    expect(filter.advance(FRAME)).toBe(false);
  });

  it('opens a graph already filtered without animating it in', () => {
    const { filter } = filterOver([10, 20, 30], 25);

    expect(filter.visible).toBe(1);
    expect([...filter.data.subarray(0, 3)]).toEqual([0, 0, 255]);
    expect(filter.advance(FRAME)).toBe(false);
    expect(filter.dirtyRows().rowCount).toBe(0);
  });

  it('reveals added notes and fades removed-note ghosts away', () => {
    const filter = new DateFilter();

    filter.adopt(new Float32Array([10, 20]), 2, 1, 0, [1], 1);

    expect([...filter.data.subarray(0, 3)]).toEqual([255, 0, 255]);
    expect(filter.advance(0, false)).toBe(false);
    expect([...filter.data.subarray(0, 3)]).toEqual([255, 255, 0]);
    expect(filter.visible).toBe(2);
  });

  it('fades a hidden note out over several frames instead of at once', () => {
    const { filter, createdDays } = filterOver([10, 20, 30]);

    filter.retarget(createdDays, 3, 25);
    expect(filter.visible).toBe(1);
    expect(filter.data[0]).toBe(255);

    filter.advance(FRAME);
    expect(filter.data[0]).toBeLessThan(255);
    expect(filter.data[0]).toBeGreaterThan(0);

    settle(filter);
    expect(filter.data[0]).toBe(0);
  });

  it('finishes visibility changes in one step when motion is disabled', () => {
    const { filter, createdDays } = filterOver([10, 20, 30]);

    filter.retarget(createdDays, 3, 25);

    expect(filter.advance(0, false)).toBe(false);
    expect([...filter.data.subarray(0, 3)]).toEqual([0, 0, 255]);
  });

  it('fades a note back in when the threshold lets it through again', () => {
    const { filter, createdDays } = filterOver([10, 20, 30], 25);

    filter.retarget(createdDays, 3, 0);
    filter.advance(FRAME);
    expect(filter.data[0]).toBeGreaterThan(0);
    expect(filter.data[0]).toBeLessThan(255);

    settle(filter);
    expect(filter.data[0]).toBe(255);
    expect(filter.visible).toBe(3);
  });

  it('takes as many frames as a label fade, so the two move together', () => {
    const { filter, createdDays } = filterOver([10, 20, 30]);

    filter.retarget(createdDays, 3, 25);
    const frames = settle(filter);

    let label = 1;
    let labelFrames = 0;
    while (label > SETTLED_FADE && labelFrames < 600) {
      label -= label * approachStep(FRAME, FADE_SECONDS);
      labelFrames += 1;
    }

    expect(Math.abs(frames - labelFrames)).toBeLessThanOrEqual(2);
  });

  it('stops asking for frames once every note settled', () => {
    const { filter, createdDays } = filterOver([10, 20, 30]);

    filter.retarget(createdDays, 3, 25);
    const frames = settle(filter);

    expect(frames).toBeGreaterThan(1);
    expect(filter.advance(FRAME)).toBe(false);
  });

  it('never hides a note without a date', () => {
    const { filter, createdDays } = filterOver([Number.NaN, 20, 30]);

    filter.retarget(createdDays, 3, 25);
    settle(filter);

    expect(filter.data[0]).toBe(255);
    expect(filter.visible).toBe(2);
  });

  it('applies creation and modification thresholds independently', () => {
    const filter = new DateFilter();
    const createdDays = new Float32Array([10, 30, 20, Number.NaN]);
    const modifiedDays = new Float32Array([30, 10, 25, Number.NaN]);
    filter.adopt(createdDays, 4, 1, 20, [], 0, modifiedDays, 20);

    expect(filter.visible).toBe(2);
    expect([...filter.data.subarray(0, 4)]).toEqual([0, 0, 255, 255]);
  });

  it('intersects inclusive creation and modification upper bounds and keeps undated notes', () => {
    const filter = new DateFilter();
    const createdDays = new Float32Array([10, 20, 30, Number.NaN]);
    const modifiedDays = new Float32Array([30, 20, 10, Number.NaN]);
    filter.adopt(createdDays, 4, 1, Number.NEGATIVE_INFINITY, [], 0,
      modifiedDays, Number.NEGATIVE_INFINITY, null, 20, 20);

    expect(filter.visible).toBe(2);
    expect([...filter.data.subarray(0, 4)]).toEqual([0, 255, 0, 255]);
  });

  it('intersects metadata matches with both date thresholds', () => {
    const filter = new DateFilter();
    const createdDays = new Float32Array([10, 30, 20]);
    const modifiedDays = new Float32Array([30, 10, 25]);
    const included = new Uint8Array([1, 1, 0]);
    filter.adopt(createdDays, 3, 1, 20, [], 0, modifiedDays, 20, included);

    expect(filter.visible).toBe(0);
    expect([...filter.data.subarray(0, 3)]).toEqual([0, 0, 0]);
  });

  it('marks only the rows it touched as dirty', () => {
    const { filter, createdDays } = filterOver([10, 20, 30]);

    expect(filter.dirtyRows().rowCount).toBe(0);
    filter.retarget(createdDays, 3, 25);
    filter.advance(FRAME);

    expect(filter.dirtyRows()).toEqual({ firstRow: 0, rowCount: 1 });
    expect(filter.data.length).toBe(NODE_TEXTURE_WIDTH);
  });
});
