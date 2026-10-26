// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { LocalGraph } from './LocalGraph';

const linkState = vi.hoisted(() => ({
  backlinks: [] as { path: string; title: string; offset: number }[],
  outgoing: [] as { target: string; title: string; path: string }[],
}));

vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../modules/links', () => ({
  getBacklinks: () => Promise.resolve(linkState.backlinks),
  getOutgoingLinks: () => Promise.resolve(linkState.outgoing),
}));

function renderGraph(overrides: { indexReady?: boolean; indexRevision?: number } = {}) {
  return mountDom(
    <LocalGraph
      workspacePath="/vault"
      documentPath="/vault/current.md"
      indexReady={overrides.indexReady ?? true}
      indexRevision={overrides.indexRevision ?? 1}
      isOpen
      onOpen={vi.fn()}
    />,
  );
}

describe('LocalGraph', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('offers local graph depths one through four', () => {
    act(() => {
      renderer = mountDom(
        <LocalGraph
          workspacePath="/vault"
          documentPath="/vault/current.md"
          indexReady
          indexRevision={1}
          isOpen
          onOpen={vi.fn()}
        />,
      );
    });

    expect([...renderer!.container.querySelectorAll('.q-local-graph__controls button')]
      .map((button) => button.textContent))
      .toEqual([
        'localGraph.incoming',
        'localGraph.outgoing',
        '1',
        '2',
        '3',
        '4',
      ]);
  });

  it('explains that the index is still building instead of loading forever', () => {
    act(() => { renderer = renderGraph({ indexReady: false }); });

    const status = renderer!.container.querySelector('.q-local-graph__status');
    expect(status?.textContent).toBe('search.indexing');
    expect(renderer!.container.textContent).not.toContain('localGraph.loading');
  });

  it('keeps the previous graph visible while an index revision rebuilds it', async () => {
    linkState.backlinks = [{ path: '/vault/a.md', title: 'A', offset: 1 }];
    act(() => { renderer = renderGraph(); });
    await actAndSettle();

    expect(renderer!.container.querySelector('.q-local-graph__canvas')).not.toBeNull();

    act(() => { renderer!.update(
      <LocalGraph
        workspacePath="/vault"
        documentPath="/vault/current.md"
        indexReady
        indexRevision={2}
        isOpen
        onOpen={vi.fn()}
      />,
    ); });

    expect(renderer!.container.querySelector('.q-local-graph__canvas')).not.toBeNull();
    expect(renderer!.container.querySelector('.q-local-graph__status')).toBeNull();
  });
});
