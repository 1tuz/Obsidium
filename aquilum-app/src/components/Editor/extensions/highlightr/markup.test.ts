import { describe, expect, it } from 'vitest';
import { clearColorMarkEdit, colorMarkEdit, coloredMarks, normalizeHighlightColor } from './markup';

function apply(source: string, edit: { from: number; to: number; insert: string }): string {
  return source.slice(0, edit.from) + edit.insert + source.slice(edit.to);
}

describe('colored Markdown highlights', () => {
  it('validates colors so HTML attributes cannot be injected', () => {
    expect(normalizeHighlightColor('#AAbbCC')).toBe('#aabbcc');
    expect(normalizeHighlightColor('red" onmouseenter="alert(1)')).toBeNull();
    expect(() => colorMarkEdit('safe', 0, 4, '#bad')).toThrow(RangeError);
  });
  it('wraps, recolors and toggles off a selected highlight without losing characters', () => {
    const raw = 'first second';
    const colored = apply(raw, colorMarkEdit(raw, 6, 12, '#ffcc00'));
    expect(colored).toBe('first <mark style="background-color: #ffcc00">second</mark>');
    const mark = coloredMarks(colored)[0];
    const recolored = apply(colored, colorMarkEdit(colored, mark.openTo, mark.textTo, '#aa00bb'));
    expect(recolored).toContain('background-color: #aa00bb');
    const next = coloredMarks(recolored)[0];
    expect(apply(recolored, colorMarkEdit(recolored, next.openTo, next.textTo, '#aa00bb'))).toBe(raw);
  });
  it('clears a marked word when the selection is inside its text', () => {
    const text = 'x <mark style="background-color: #aabbcc">word</mark> y';
    const mark = coloredMarks(text)[0];
    const edit = clearColorMarkEdit(text, mark.openTo + 1, mark.textTo - 1);
    expect(edit).not.toBeNull();
    expect(apply(text, edit!)).toBe('x word y');
  });
  it('inserts an empty mark with the caret inside', () => {
    const result = colorMarkEdit('a', 1, 1, '#cc88ff');
    expect(result.anchor).toBe(result.head);
    expect(result.insert.slice(result.anchor - result.from)).toBe('</mark>');
  });
});
