import { describe, expect, it } from 'vitest';
import { pageRankHighlightCount } from './nodeMetrics';

describe('pageRankHighlightCount', () => {
  it('returns no nodes for an empty graph and rounds partial percentages up', () => {
    expect(pageRankHighlightCount(0)).toBe(0);
    expect(pageRankHighlightCount(1)).toBe(1);
    expect(pageRankHighlightCount(21)).toBe(2);
    expect(pageRankHighlightCount(100)).toBe(5);
    expect(pageRankHighlightCount(100_000)).toBe(5_000);
  });
});
