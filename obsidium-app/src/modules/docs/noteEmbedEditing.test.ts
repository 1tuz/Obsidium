import { ChangeSet, Text } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { localChange, noteEmbedBodyRange, textChange } from './noteEmbedEditing';

function doc(source: string): Text {
  return Text.of(source.split('\n'));
}

function body(text: Text, heading: string | null): string {
  const range = noteEmbedBodyRange(text, heading);
  return range ? text.sliceString(range.from, range.to) : '<none>';
}

describe('note embed body range', () => {
  it('excludes the heading line and stops at the next peer heading', () => {
    const source = '# Intro\nintro\n## Plan\n- one\n### Detail\ndetail\n## Next\nend';
    const text = doc(source);
    const range = noteEmbedBodyRange(text, 'Plan');
    expect(range).not.toBeNull();
    expect(range!.from).toBe(source.indexOf('- one'));
    expect(range!.to).toBe(source.indexOf('\n## Next'));
    expect(text.sliceString(range!.from, range!.to)).toBe('- one\n### Detail\ndetail');
  });

  it('treats a heading at the end of the note as extending to the document end', () => {
    const text = doc('intro\n# Plan\nbody\nmore');
    expect(body(text, 'plan')).toBe('body\nmore');
  });

  it('ignores headings inside fenced code blocks', () => {
    const text = doc('# Intro\n```md\n## Plan\n```\n## Plan\nreal');
    expect(body(text, 'Plan')).toBe('real');
    expect(noteEmbedBodyRange(doc('```\n## Plan\n```'), 'Plan')).toBeNull();
  });

  it('returns null when the heading is missing', () => {
    expect(noteEmbedBodyRange(doc('# Intro\ntext'), 'Missing')).toBeNull();
  });

  it('skips frontmatter and keeps offsets relative to the whole text', () => {
    const source = '---\ntitle: x\n---\n# Plan\nbody\n';
    const text = doc(source);
    const range = noteEmbedBodyRange(text, 'Plan');
    expect(range).not.toBeNull();
    expect(range!.from).toBe(source.indexOf('body'));
    expect(range!.to).toBe(text.length);
    expect(text.sliceString(range!.from, range!.to)).toBe('body\n');
  });

  it('covers the body when no heading is requested', () => {
    const source = '---\ntags: []\n---\nbody';
    const range = noteEmbedBodyRange(doc(source), null);
    expect(range).toEqual({ from: source.indexOf('body'), to: source.length });
  });
});

describe('local change sets', () => {
  it('places a slice edit inside the source range and leaves the rest untouched', () => {
    const source = 'a\n## Plan\nbody text\n## Next\nz';
    const text = doc(source);
    const range = noteEmbedBodyRange(text, 'Plan')!;
    const slice = text.sliceString(range.from, range.to);
    const local = ChangeSet.of({ from: 0, to: 4, insert: 'BODY' }, slice.length);
    const full = localChange(local, range, text);
    const next = full.apply(text);
    expect(next.sliceString(0, range.from)).toBe(source.slice(0, range.from));
    expect(next.toString()).toBe(source.replace('body text', 'BODY text'));
  });

  it('restores the original when the inverse change set is applied', () => {
    const source = 'a\n## Plan\nbody text\n## Next\nz';
    const text = doc(source);
    const range = noteEmbedBodyRange(text, 'Plan')!;
    const slice = text.sliceString(range.from, range.to);
    const next = localChange(
      ChangeSet.of({ from: 0, to: 4, insert: 'BODY' }, slice.length),
      range,
      text,
    ).apply(text);
    const edited = next.sliceString(range.from, range.from + 9);
    const back = localChange(textChange(edited, slice)!, range, next);
    expect(back.apply(next).toString()).toBe(source);
  });

  it('starts a body on a new line when the heading ends the note', () => {
    const text = doc('## Plan');
    const range = noteEmbedBodyRange(text, 'Plan')!;
    const next = localChange(ChangeSet.of({ from: 0, to: 0, insert: 'x' }, 0), range, text).apply(text);
    expect(next.toString()).toBe('## Plan\nx');
    expect(noteEmbedBodyRange(next, 'Plan')).toEqual({ from: 8, to: 9 });
  });
});

describe('text change', () => {
  it('returns null for equal strings', () => {
    expect(textChange('same', 'same')).toBeNull();
  });

  it('returns the minimal changed range', () => {
    const change = textChange('hello world', 'hello brave world');
    expect(change).not.toBeNull();
    expect(change!.apply(doc('hello world')).toString()).toBe('hello brave world');
    change!.iterChanges((fromA, toA) => {
      expect([fromA, toA]).toEqual([6, 6]);
    });
  });

  it('handles deletions at the end of the text', () => {
    const change = textChange('line\n', 'line');
    expect(change).not.toBeNull();
    expect(change!.apply(doc('line\n')).toString()).toBe('line');
  });
});
