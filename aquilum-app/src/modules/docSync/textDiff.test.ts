import { describe, expect, it } from 'vitest';
import { caretAtSameLine, diffText } from './textDiff';

function apply(previous: string, next: string): string {
  const edit = diffText(previous, next);
  if (!edit) return previous;
  return previous.slice(0, edit.from) + edit.insert + previous.slice(edit.to);
}

describe('diffText', () => {
  it('returns null for equal text', () => {
    expect(diffText('одинаково', 'одинаково')).toBeNull();
  });

  it('describes an insertion in the middle as one operation', () => {
    expect(diffText('abc', 'abXc')).toEqual({ from: 2, to: 2, insert: 'X' });
  });

  it('describes a deletion as one operation', () => {
    expect(diffText('abXc', 'abc')).toEqual({ from: 2, to: 3, insert: '' });
  });

  it('handles append, prepend and full replacement', () => {
    expect(apply('заметка', 'заметка и хвост')).toBe('заметка и хвост');
    expect(apply('заметка', 'начало и заметка')).toBe('начало и заметка');
    expect(apply('', 'первый текст')).toBe('первый текст');
    expect(apply('было', '')).toBe('');
  });

  it('keeps surrogate pairs whole', () => {
    const edit = diffText('привет 😀', 'привет 😃');
    expect(edit).not.toBeNull();
    expect(edit!.to - edit!.from).toBe(2);
    expect(apply('привет 😀', 'привет 😃')).toBe('привет 😃');
  });

  it('does not split a pair when the tail matches', () => {
    expect(apply('a😀b', 'a😃b')).toBe('a😃b');
  });
});

describe('caretAtSameLine', () => {
  const previous = 'первая\nвторая\nтретья\n';

  it('keeps the caret on the same line and column', () => {
    const next = 'ПЕРВАЯ\nВТОРАЯ\nТРЕТЬЯ\n';
    const caret = previous.indexOf('вторая') + 3;
    expect(caretAtSameLine(previous, next, caret)).toBe(next.indexOf('ВТОРАЯ') + 3);
  });

  it('clamps to the end of a line that became shorter', () => {
    const next = 'первая\nвт\nтретья\n';
    const caret = previous.indexOf('вторая') + 6;
    expect(caretAtSameLine(previous, next, caret)).toBe(next.indexOf('вт') + 2);
  });

  it('falls back to the end of the document when the line disappeared', () => {
    const next = 'только одна строка';
    const caret = previous.indexOf('третья');
    expect(caretAtSameLine(previous, next, caret)).toBe(next.length);
  });

  it('handles the first line and out-of-range positions', () => {
    expect(caretAtSameLine(previous, 'другая\nвторая\n', 3)).toBe(3);
    expect(caretAtSameLine(previous, 'x', previous.length + 100)).toBe(1);
  });
});
