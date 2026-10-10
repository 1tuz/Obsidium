import { describe, expect, it } from 'vitest';
import { renameCommunity, setCommunityCollapsed } from './communityNames';

describe('renameCommunity', () => {
  it('adds, replaces, and removes a custom name by stable community identity', () => {
    const initial = { '1:2': 'Research' };
    expect(renameCommunity(initial, '3:4', 'Projects')).toEqual({ ...initial, '3:4': 'Projects' });
    expect(renameCommunity(initial, '1:2', 'Reading')).toEqual({ '1:2': 'Reading' });
    expect(renameCommunity(initial, '1:2', '')).toEqual({});
  });

  it('keeps names for every cluster while bounding each name length', () => {
    const names = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`${index}`, 'Name']));
    const updated = renameCommunity(names, 'latest', 'x'.repeat(80));
    expect(Object.keys(updated)).toHaveLength(301);
    expect(updated.latest).toBe('x'.repeat(60));
    expect(updated['0']).toBe('Name');
  });

  it('adds and removes stable community collapse preferences', () => {
    expect(setCommunityCollapsed({}, '12:34', true)).toEqual({ '12:34': true });
    expect(setCommunityCollapsed({ '12:34': true }, '12:34', false)).toEqual({});
  });

  it('keeps collapse preferences when more than 256 clusters are customized', () => {
    const collapsed = Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`${index}`, true]));
    expect(Object.keys(setCommunityCollapsed(collapsed, 'latest', true))).toHaveLength(301);
  });
});
