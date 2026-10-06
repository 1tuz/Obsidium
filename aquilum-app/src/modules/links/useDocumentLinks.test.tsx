import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDocumentLinks, type DocumentLinks, type LinkMode } from './useDocumentLinks';

const gateway = vi.hoisted(() => ({
  getBacklinks: vi.fn(),
  getOutgoingLinks: vi.fn(),
}));

vi.mock('./gateway', () => gateway);

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let latest: { result: DocumentLinks | null; loading: boolean } | null = null;

function Harness({ mode }: { mode: LinkMode }) {
  latest = useDocumentLinks(mode, 'C:\\notes', 'C:\\notes\\Current.md', true, 1, true);
  return null;
}

describe('useDocumentLinks', () => {
  let renderer: ReactTestRenderer | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    latest = null;
    vi.clearAllMocks();
  });

  it('ignores a stale request after the mode changes', async () => {
    let resolveBacklinks!: (links: Array<{ path: string; title: string; offset: number }>) => void;
    gateway.getBacklinks.mockReturnValue(new Promise((resolve) => {
      resolveBacklinks = resolve;
    }));
    gateway.getOutgoingLinks.mockResolvedValue([
      { target: 'Target', title: 'Target', path: 'C:\\notes\\Target.md' },
    ]);

    await act(async () => {
      renderer = create(<Harness mode="backlinks" />);
    });
    await act(async () => {
      renderer?.update(<Harness mode="outgoing" />);
    });

    expect(latest?.result?.mode).toBe('outgoing');

    await act(async () => {
      resolveBacklinks([{ path: 'C:\\notes\\Source.md', title: 'Source', offset: 1 }]);
    });

    expect(latest?.result?.mode).toBe('outgoing');
    expect(gateway.getBacklinks).toHaveBeenCalledOnce();
    expect(gateway.getOutgoingLinks).toHaveBeenCalledOnce();
  });
});
