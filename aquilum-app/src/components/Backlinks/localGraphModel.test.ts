import { describe, expect, it } from 'vitest';
import { buildLocalGraph, type LocalGraphGateway } from './localGraphModel';

const gateway: LocalGraphGateway = {
  backlinks: async (_workspace, path) => path.endsWith('A.md')
    ? [{ path: '/vault/B.md', title: 'B', offset: 0 }]
    : path.endsWith('B.md')
      ? [{ path: '/vault/C.md', title: 'C', offset: 0 }]
      : [],
  outgoing: async (_workspace, path) => path.endsWith('A.md')
    ? [{ target: 'D', title: 'D', path: '/vault/D.md' }]
    : [],
};

describe('buildLocalGraph', () => {
  it('builds one hop in both directions', async () => {
    const result = await buildLocalGraph({
      workspacePath: '/vault',
      documentPath: '/vault/A.md',
      depth: 1,
      incoming: true,
      outgoing: true,
    }, gateway);
    expect(result.nodes.map((node) => node.title).sort()).toEqual(['A', 'B', 'D']);
    expect(result.edges).toHaveLength(2);
  });

  it('expands only to the requested depth', async () => {
    const result = await buildLocalGraph({
      workspacePath: '/vault',
      documentPath: '/vault/A.md',
      depth: 2,
      incoming: true,
      outgoing: false,
    }, gateway);
    expect(result.nodes.map((node) => node.title).sort()).toEqual(['A', 'B', 'C']);
  });
});
