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

  it('traverses four hops, deduplicates cycles, and respects the node cap', async () => {
    const chain: LocalGraphGateway = {
      backlinks: async () => [],
      outgoing: async (_workspace, path) => {
        if (path === '/vault/D.md') {
          return [
            { target: 'E', title: 'E', path: '/vault/E.md' },
            { target: 'A', title: 'A', path: '/vault/A.md' },
          ];
        }
        const next = path === '/vault/A.md' ? 'B'
          : path === '/vault/B.md' ? 'C'
            : path === '/vault/C.md' ? 'D'
              : null;
        return next
          ? [{ target: next, title: next, path: `/vault/${next}.md` }]
          : [];
      },
    };
    const options = {
      workspacePath: '/vault',
      documentPath: '/vault/A.md',
      depth: 4 as const,
      incoming: false,
      outgoing: true,
    };

    const result = await buildLocalGraph(options, chain);
    const capped = await buildLocalGraph({ ...options, maxNodes: 3 }, chain);

    expect(result.nodes.map((node) => node.title)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(result.edges).toHaveLength(5);
    expect(capped.nodes.map((node) => node.title)).toEqual(['A', 'B', 'C']);
    expect(capped.edges).toHaveLength(2);
  });
});
