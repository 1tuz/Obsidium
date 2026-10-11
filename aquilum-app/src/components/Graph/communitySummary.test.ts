import { describe, expect, it, vi } from 'vitest';
import * as summary from './communitySummary';

describe('communityIndex', () => {
  it('uses each community hub as representative and ranks by size', () => {
    const index = summary.buildCommunityIndex(
      new Uint32Array([4, 4, 1, 1, 1]),
      new Uint32Array([1, 9, 2, 8, 3]),
      new Uint32Array([12, 0, 14, 0, 16, 0, 18, 0, 20, 0]),
    );
    expect(index.total).toBe(2);
    expect(summary.communityPage(index, 0)).toEqual([
      { id: 1, count: 3, node: 3 },
      { id: 4, count: 2, node: 1 },
    ]);
  });

  it('uses stable node identifiers to break degree ties', () => {
    const index = summary.buildCommunityIndex(
      new Uint32Array([0, 0]),
      new Uint32Array([4, 4]),
      new Uint32Array([20, 0, 10, 0]),
    );
    expect(summary.communityPage(index, 0)).toEqual([{ id: 0, count: 2, node: 1 }]);
  });

  it('restores collapsed communities by representative stable IDs after Louvain IDs reorder', () => {
    const index = summary.buildCommunityIndex(
      new Uint32Array([1, 0, 0]),
      new Uint32Array([5, 1, 2]),
      new Uint32Array([11, 0, 0, 0, 31, 0]),
    );
    expect(summary.collapsedCommunityIds(index, { '0:11': true }))
      .toEqual([1]);
  });

  it('ignores stale representative IDs and false preference entries', () => {
    const index = summary.buildCommunityIndex(
      new Uint32Array([0, 1]),
      new Uint32Array([2, 1]),
      new Uint32Array([11, 0, 31, 0]),
    );
    expect(summary.collapsedCommunityIds(index, {
      '0:11': true,
      '0:31': false,
      '0:99': true,
    })).toEqual([0]);
  });

  it('returns only the active page of representatives', () => {
    const ids = new Uint32Array(Array.from({ length: 14 }, (_, index) => index));
    const index = summary.buildCommunityIndex(ids, new Uint32Array(14), new Uint32Array(28));
    expect(summary.communityPage(index, 1)).toEqual([
      { id: 12, count: 1, node: 12 },
      { id: 13, count: 1, node: 13 },
    ]);
  });

  it('bounds the sorted page collection to 12 entries for 100,000 communities', () => {
    const nodeCount = 100_000;
    const communityIds = new Uint32Array(nodeCount);
    const degrees = new Uint32Array(nodeCount);
    const nodeIds = new Uint32Array(nodeCount * 2);
    for (let node = 0; node < nodeCount; node += 1) {
      communityIds[node] = node;
      degrees[node] = node % 97;
      nodeIds[node * 2] = nodeCount - node;
    }
    const index = summary.buildCommunityIndex(communityIds, degrees, nodeIds);
    const page = summary.communityPage(index, 0);
    expect(index.total).toBe(nodeCount);
    expect(page).toHaveLength(12);
    expect(page.map(({ id }) => id)).toEqual(Array.from({ length: 12 }, (_, id) => id));
    const representativeId = summary.communityStableId(nodeIds, index.representatives[50_000]);
    const lookup = vi.spyOn(index.communityByRepresentativeId, 'get');
    expect(summary.collapsedCommunityIds(index, { [representativeId]: true })).toEqual([50_000]);
    expect(lookup).toHaveBeenCalledOnce();
  });

  it('does not recount representatives when pages or collapse settings change', () => {
    const build = vi.spyOn(summary, 'buildCommunityIndex');
    const ids = new Uint32Array([0, 1, 1, 2]);
    const nodeIds = new Uint32Array([1, 0, 2, 0, 3, 0, 4, 0]);
    const index = summary.buildCommunityIndex(ids, new Uint32Array([5, 2, 3, 1]), nodeIds);
    const counts = index.counts;
    const representatives = index.representatives;

    summary.communityPage(index, 0);
    summary.communityPage(index, 1);
    summary.collapsedCommunityIds(index, { '0:1': true });
    summary.collapsedCommunityIds(index, { '0:4': true });

    expect(build).toHaveBeenCalledOnce();
    expect(index.counts).toBe(counts);
    expect(index.representatives).toBe(representatives);
    build.mockRestore();
  });
});

describe('clampCommunityPage', () => {
  it('clamps a shrunken graph and keeps the page stable as its child remounts', () => {
    expect(summary.clampCommunityPage(8, 100)).toBe(8);
    expect(summary.clampCommunityPage(8, 14)).toBe(1);
    expect(summary.clampCommunityPage(summary.clampCommunityPage(8, 14), 100)).toBe(1);
  });
});
