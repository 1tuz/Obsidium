import { describe, expect, it } from 'vitest';
import { customGroupIds, groupRuleColors } from './customGroupIds';

describe('customGroupIds', () => {
  it('assigns token colors in rule order and ignores invalid node indices', () => {
    const ids = customGroupIds(4, [
      [1, 2, -1], [2, 3], [4],
    ]);

    expect([...ids]).toEqual([0, 1, 1, 2]);
  });

  it('keeps ordered rule IDs wider than the old three palette slots', () => {
    const matches = Array.from({ length: 260 }, (_, index) => [index]);
    const ids = customGroupIds(260, matches);

    expect(ids).toBeInstanceOf(Uint32Array);
    expect(ids[0]).toBe(1);
    expect(ids[254]).toBe(255);
    expect(ids[255]).toBe(256);
    expect(ids[259]).toBe(260);
  });

  it('resolves custom hex colors and keeps theme colors as the fallback', () => {
    const palette = {
      fill: [0, 0, 0, 1],
      cold: [0.1, 0.2, 0.3, 0.4],
      hot: [0.5, 0.6, 0.7, 0.8],
      edgeActive: [0.9, 0.8, 0.7, 0.6],
    } as never;
    const rules = [
      { id: 'theme', field: 'folder' as const, key: '', value: 'a', color: 'cold' as const },
      { id: 'custom', field: 'folder' as const, key: '', value: 'b', color: 'hot' as const, customColor: '#1471eb' },
      { id: 'invalid', field: 'folder' as const, key: '', value: 'c', color: 'accent' as const, customColor: 'red' },
      { id: 'legacy', field: 'folder' as const, key: '', value: 'd', color: 'invalid' as never },
    ];

    const colors = groupRuleColors(rules, palette);
    const expected = [
      0.1, 0.2, 0.3, 0.4,
      20 / 255, 113 / 255, 235 / 255, 1,
      0.9, 0.8, 0.7, 0.6,
      0.1, 0.2, 0.3, 0.4,
    ];
    colors.forEach((color, index) => expect(color).toBeCloseTo(expected[index], 6));
  });
});
