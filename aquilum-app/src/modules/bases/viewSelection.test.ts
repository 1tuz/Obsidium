import { describe, expect, it } from 'vitest';
import { resolveBaseViewIndex } from './viewSelection';

describe('resolveBaseViewIndex', () => {
  it('opens the explicitly requested view even when another view was last active', () => {
    expect(resolveBaseViewIndex(2, 0, 3)).toBe(2);
  });

  it('returns the saved view for an ordinary Base open and clamps removed views', () => {
    expect(resolveBaseViewIndex(undefined, 1, 3)).toBe(1);
    expect(resolveBaseViewIndex(undefined, 4, 2)).toBe(1);
  });
});
