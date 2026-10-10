import { describe, expect, it } from 'vitest';
import { moveOutlineSubtree, outlineChildRange } from './move';

function apply(source: string, outcome: NonNullable<ReturnType<typeof moveOutlineSubtree>>): string {
  return source.slice(0, outcome.from) + outcome.insert + source.slice(outcome.to);
}

describe('Outliner branch moves', () => {
  it('moves a list branch together with its children and does not duplicate text', () => {
    const source = '- alpha\n    - alpha child\n- beta\n    - beta child\n';
    const from = source.indexOf('- beta');
    const action = moveOutlineSubtree(source, from + 2, 'up');
    expect(action).not.toBeNull();
    expect(apply(source, action!)).toBe('- beta\n    - beta child\n- alpha\n    - alpha child\n');
    expect(action!.caret).toBe(2);
  });
  it('moves downward while preserving the final newline', () => {
    const source = '- alpha\n- beta\n    - beta child\n';
    const outcome = moveOutlineSubtree(source, 2, 'down');
    expect(outcome).not.toBeNull();
    expect(apply(source, outcome!)).toBe('- beta\n    - beta child\n- alpha\n');
    expect(outcome!.caret).toBe('- beta\n    - beta child\n'.length + 2);
  });
  it('does not move a child past its parent', () => {
    const source = '- alpha\n    - child\n- beta';
    expect(moveOutlineSubtree(source, source.indexOf('child'), 'up')).toBeNull();
  });
  it('blocks crossing an unrelated paragraph or another list', () => {
    const source = '- alpha\nparagraph\n- beta';
    expect(moveOutlineSubtree(source, source.indexOf('beta'), 'up')).toBeNull();
  });
  it('folds all descendants but excludes the next sibling', () => {
    const source = '- first\n    - child\n    - child2\n- second\n';
    const range = outlineChildRange(source, 1);
    expect(range).not.toBeNull();
    expect(source.slice(range!.from, range!.to)).toBe('\n    - child\n    - child2');
  });
});
