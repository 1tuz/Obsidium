// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { LocalGraph } from './LocalGraph';

vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../modules/links', () => ({
  getBacklinks: async () => [],
  getOutgoingLinks: async () => [],
}));

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
});
