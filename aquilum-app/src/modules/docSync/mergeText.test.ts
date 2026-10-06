import { describe, expect, it } from 'vitest';
import { COARSE_MERGE_THRESHOLD } from './lineDiff';
import { mergeExternalChange } from './mergeText';

function applyEdits(text: string, edits: ReturnType<typeof mergeExternalChange>['edits']): string {
  let result = text;
  for (const edit of [...edits].sort((left, right) => right.from - left.from)) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}

function merge(base: string, disk: string, current: string) {
  const result = mergeExternalChange(base, disk, current);
  return { ...result, text: applyEdits(current, result.edits) };
}

describe('mergeExternalChange', () => {
  it('keeps a local edit that sits in a different paragraph from the external one', () => {
    const base = 'первый\n\nвторой\n\nтретий\n';
    const disk = 'первый\n\nвторой\n\nтретий переписан агентом\n';
    const current = 'первый абзац дополнен вручную\n\nвторой\n\nтретий\n';

    const result = merge(base, disk, current);

    expect(result.text).toBe('первый абзац дополнен вручную\n\nвторой\n\nтретий переписан агентом\n');
    expect(result.displaced).toEqual([]);
  });

  it('produces one small edit per changed region instead of rewriting everything between them', () => {
    const base = 'a\nb\nc\nd\ne\nf\ng\n';
    const disk = 'a\nB\nc\nd\ne\nf\nG\n';

    const result = mergeExternalChange(base, disk, base);

    expect(result.edits.length).toBe(2);
    expect(result.edits.every((edit) => edit.to - edit.from < 4)).toBe(true);
  });

  it('applies an external append while the user is typing on an earlier line', () => {
    const base = 'заголовок\n\nтекст\n';
    const disk = 'заголовок\n\nтекст\n\nдописано агентом\n';
    const current = 'заголовок\n\nтекст с добавкой\n';

    const result = merge(base, disk, current);

    expect(result.text).toBe('заголовок\n\nтекст с добавкой\n\nдописано агентом\n');
    expect(result.displaced).toEqual([]);
  });

  it('reports the local lines it had to displace when both sides changed the same line', () => {
    const base = 'один\nдва\nтри\n';
    const disk = 'один\nдва от агента\nтри\n';
    const current = 'один\nдва от пользователя\nтри\n';

    const result = merge(base, disk, current);

    expect(result.text).toBe('один\nдва от агента\nтри\n');
    expect(result.displaced).toEqual(['два от пользователя']);
  });

  it('does nothing when the file did not move', () => {
    const base = 'один\nдва\n';
    expect(mergeExternalChange(base, base, 'один\nдва изменённый\n').edits).toEqual([]);
  });

  it('does nothing when both sides already agree', () => {
    expect(mergeExternalChange('старое\n', 'новое\n', 'новое\n').edits).toEqual([]);
  });

  it('handles an external change to the very last line without a trailing newline', () => {
    const result = merge('один\nдва', 'один\nдва и хвост', 'один\nдва');
    expect(result.text).toBe('один\nдва и хвост');
  });

  it('handles an external change to the very first line', () => {
    const result = merge('один\nдва\n', 'ОДИН\nдва\n', 'один\nдва\n');
    expect(result.text).toBe('ОДИН\nдва\n');
  });

  it('handles deletion of a middle line by the external writer', () => {
    const result = merge('a\nb\nc\n', 'a\nc\n', 'a\nb\nc\n');
    expect(result.text).toBe('a\nc\n');
  });

  it('merges an external deletion with an unrelated local insertion', () => {
    const result = merge('a\nb\nc\nd\n', 'a\nb\nd\n', 'a\nb\nc\nd\nдобавлено\n');
    expect(result.text).toBe('a\nb\nd\nдобавлено\n');
  });

  it('takes the whole file when the document is empty', () => {
    const result = merge('', 'первая строка\nвторая\n', '');
    expect(result.text).toBe('первая строка\nвторая\n');
  });

  it('keeps the header on top when an empty document takes a file with a blank line inside', () => {
    const disk = 'Дата: 26-03-2025\nТип: #учебник\n\n\n- тело\n\n***\n\nСсылки:\n- [[]]';
    expect(merge('', disk, '').text).toBe(disk);
  });

  it('never reorders the file when an empty document takes it', () => {
    let seed = 20260818;
    const random = (bound: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };
    for (let round = 0; round < 400; round += 1) {
      const disk = Array.from(
        { length: random(14) },
        (_, index) => (random(3) === 0 ? '' : `строка ${index}`),
      ).join('\n');
      expect(merge('', disk, '').text).toBe(disk);
    }
  });

  it('lands exactly on the file whenever the document has no local change', () => {
    let seed = 20260817;
    const random = (bound: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };
    const line = (index: number) => (random(4) === 0 ? '' : `строка ${index}`);
    for (let round = 0; round < 400; round += 1) {
      const base = Array.from({ length: random(12) }, (_, index) => line(index));
      const disk = [...base];
      for (let change = random(4); change > 0; change -= 1) {
        const at = random(disk.length + 1);
        if (random(2) === 0 || at >= disk.length) disk.splice(at, 0, `вставка ${change}`);
        else disk.splice(at, 1, `замена ${change}`);
      }
      const baseText = base.join('\n');
      const diskText = disk.join('\n');
      expect(merge(baseText, diskText, baseText).text).toBe(diskText);
    }
  });

  it('reports edits that never share a position, so their order cannot matter', () => {
    let seed = 20260819;
    const random = (bound: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };
    for (let round = 0; round < 400; round += 1) {
      const base = Array.from(
        { length: random(14) },
        (_, index) => (random(3) === 0 ? '' : `строка ${index}`),
      );
      const disk = [...base];
      for (let change = random(5); change > 0; change -= 1) {
        const at = random(disk.length + 1);
        if (random(2) === 0 || at >= disk.length) disk.splice(at, 0, `вставка ${change}`);
        else disk.splice(at, 1, `замена ${change}`);
      }
      const current = random(3) === 0 ? '' : base.join('\n');
      const { edits } = mergeExternalChange(base.join('\n'), disk.join('\n'), current);
      let reach = -1;
      for (const edit of edits) {
        expect(edit.from).toBeGreaterThan(reach);
        expect(edit.to).toBeGreaterThanOrEqual(edit.from);
        reach = edit.to;
      }
    }
  });

  it('falls back to a coarse merge on huge divergence and says so out loud', () => {
    const base = Array.from({ length: 20 }, (_, index) => `строка ${index}`).join('\n');
    const disk = Array.from(
      { length: COARSE_MERGE_THRESHOLD + 5 },
      (_, index) => `совсем другое ${index}`,
    ).join('\n');

    const result = merge(base, disk, base);

    expect(result.coarse).toBe(true);
    expect(result.text).toBe(disk);
  });

  it('never drops local lines even when it merges coarsely', () => {
    const base = Array.from({ length: 20 }, (_, index) => `строка ${index}`).join('\n');
    const disk = Array.from(
      { length: COARSE_MERGE_THRESHOLD + 5 },
      (_, index) => `совсем другое ${index}`,
    ).join('\n');
    const current = base.replace('строка 5', 'моя правка');

    const result = merge(base, disk, current);

    expect(result.coarse).toBe(true);
    expect(result.displaced).toContain('моя правка');
  });

  it('marks an ordinary merge as precise', () => {
    expect(mergeExternalChange('a\nb\n', 'a\nB\n', 'a\nb\n').coarse).toBe(false);
  });

  it('survives a document that lost everything locally', () => {
    const result = merge('a\nb\nc\n', 'a\nb\nc\nd\n', '');
    expect(result.text).toContain('d');
  });
});
