import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { noteDateToIso, parseNoteDate } from './index';

interface Case {
  input: string;
  date: string | null;
}

const cases: Case[] = JSON.parse(readFileSync(new URL(
  '../../../tests/fixtures/note-dates.json',
  import.meta.url,
), 'utf8'));

describe('parseNoteDate', () => {
  it.each(cases)('$input matches the shared fixture', ({ input, date }) => {
    const parsed = parseNoteDate(input);
    expect(parsed === null ? null : noteDateToIso(parsed)).toBe(date);
  });

  it('returns the civil fields of a day-first value', () => {
    expect(parseNoteDate('24.10.2026')).toEqual({ year: 2026, month: 10, day: 24 });
  });
});

describe('noteDateToIso', () => {
  it('pads year, month and day', () => {
    expect(noteDateToIso({ year: 2026, month: 4, day: 7 })).toBe('2026-04-07');
  });
});
