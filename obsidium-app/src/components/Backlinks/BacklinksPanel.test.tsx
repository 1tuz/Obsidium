// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { actAndSettle, mountDom, type MountedDom } from '../../testing/mountDom';
import { BacklinksPanel } from './BacklinksPanel';

const linkMocks = vi.hoisted(() => ({
  backlink: {
    path: 'C:\\notes\\Source.md',
    title: 'Source',
    offset: 3,
  },
  outgoing: {
    target: 'Target',
    title: 'Target',
    path: 'C:\\notes\\Target.md',
  },
}));

const linkState = vi.hoisted(() => ({
  backlinks: null as unknown[] | null,
  outgoing: null as unknown[] | null,
  loading: false,
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => []) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('../../i18n', () => ({
  t: (key: string, params?: Record<string, string | number>) => (
    params && 'name' in params ? `${key}|${params.name}` : key
  ),
  getLocale: () => 'en',
  plural: (key: string) => key,
  formatNumber: (value: number) => String(value),
}));
vi.mock('../../modules/settings', () => ({
  useSettingsStore: () => ({
    config: {
      analysis: {
        enableBm25f: true,
        enableAdamicAdar: true,
        enableWikixiv: true,
        bm25fParams: {
          k1: 1.2,
          k3: 8,
          bTitle: 0.3,
          bBody: 0.75,
          titleWeight: 2.5,
        },
      },
    },
  }),
}));
vi.mock('../../modules/links', () => ({
  useDocumentLinks: (mode: 'backlinks' | 'outgoing') => ({
    result: linkState[mode] === null ? null : { mode, items: linkState[mode] },
    loading: linkState.loading,
  }),
}));
vi.mock('../../modules/wikixiv', () => ({
  useWikixivSources: () => ({
    hits: [],
    offline: false,
    insufficientText: false,
    failed: false,
    loading: false,
  }),
  setWikiHover: () => {},
  clearWikiHover: () => {},
}));
vi.mock('../../modules/openExternalUrl', () => ({
  openExternalUrl: vi.fn(),
}));

interface PanelOverrides {
  documentPath?: string | null;
  historyRequest?: number;
}

function mountPanel({ documentPath = 'C:\\notes\\Current.md', historyRequest }: PanelOverrides = {}) {
  const onOpenBacklink = vi.fn();
  const onOpenOutgoing = vi.fn();
  const renderer = mountDom(
    <BacklinksPanel
      workspacePath="C:\\notes"
      documentPath={documentPath}
      activeTabId={null}
      indexReady
      indexRevision={1}
      isOpen
      historyRequest={historyRequest}
      onOpenBacklink={onOpenBacklink}
      onOpenOutgoing={onOpenOutgoing}
      onOpenAnalysis={vi.fn()}
      onOpenLocalGraph={vi.fn()}
    />,
  );
  const panel = renderer.container;
  const modeButtons = [...panel.querySelectorAll<HTMLButtonElement>('.q-backlinks__mode-button')];
  const pressed = () => modeButtons.map((button) => button.getAttribute('aria-pressed'));
  return { renderer, panel, modeButtons, pressed, onOpenBacklink, onOpenOutgoing };
}

function emptyReport() {
  return {
    brokenLinks: [],
    isolatedNotes: [],
    staleNotes: [],
    unusedTags: { tags: [], total: 0, truncated: false },
    staleAfterDays: 90,
    indexedDocuments: 2,
    indexing: false,
  };
}

describe('BacklinksPanel', () => {
  let renderer: MountedDom | null = null;
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
      clear: () => storage.clear(),
    });
    linkState.backlinks = [linkMocks.backlink];
    linkState.outgoing = [linkMocks.outgoing];
    linkState.loading = false;
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === 'get_knowledge_report') return emptyReport();
      if (command === 'note_history') return { total: 0, versions: [] };
      return [];
    });
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    vi.unstubAllGlobals();
  });

  it('opens on vault analytics without an open note', async () => {
    const mounted = mountPanel({ documentPath: null });
    renderer = mounted.renderer;
    await actAndSettle();

    expect(mounted.pressed()).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(mounted.panel.querySelector('.q-knowledge-report')).not.toBeNull();
    expect(mounted.panel.querySelector('.q-activity-heatmap')).not.toBeNull();
    expect(mounted.panel.querySelector('.q-recent-changes')).not.toBeNull();
    expect(mounted.panel.querySelector('.q-backlinks__scope-name')?.textContent)
      .toBe('backlinks.vaultTitle');
  });

  it('switches to history when requested by a file context menu', async () => {
    const mounted = mountPanel({ historyRequest: 1 });
    renderer = mounted.renderer;
    await actAndSettle();

    expect(mounted.pressed()).toEqual(['false', 'false', 'false', 'false', 'false', 'true']);
    expect(mounted.panel.querySelector('.q-backlinks__scope-name')?.textContent)
      .toBe('backlinks.historyTitle|Current');
  });

  it('migrates an unknown stored mode to vault', async () => {
    localStorage.setItem('obsidium_backlinks_mode', JSON.stringify('nonsense'));
    const mounted = mountPanel({ documentPath: null });
    renderer = mounted.renderer;
    await actAndSettle();
    await actAndSettle();

    expect(mounted.pressed()).toEqual(['true', 'false', 'false', 'false', 'false', 'false']);
    expect(mounted.panel.querySelector('.q-knowledge-report')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('obsidium_backlinks_mode') ?? 'null')).toBe('vault');
  });

  it('switches the pressed mode, names the note and renders document-name rows', () => {
    localStorage.setItem('obsidium_backlinks_mode', JSON.stringify('backlinks'));
    const mounted = mountPanel();
    renderer = mounted.renderer;
    const { panel, modeButtons, pressed } = mounted;

    expect(pressed()).toEqual(['false', 'true', 'false', 'false', 'false', 'false']);
    expect(panel.querySelector('h2')?.textContent).toBe('backlinks.mentionsTitle');
    expect(panel.querySelector('.q-backlinks__scope-name')?.textContent)
      .toBe('backlinks.noteTitle|Current');
    expect(panel.querySelector('.q-sidebar-document-item__title')?.textContent).toBe('Source');

    act(() => modeButtons[2].click());

    expect(pressed()).toEqual(['false', 'false', 'true', 'false', 'false', 'false']);
    expect(panel.querySelector('h2')?.textContent).toBe('backlinks.outgoingTitle');
    const outgoingButton = panel.querySelector<HTMLElement>('.q-sidebar-document-item')!;
    expect(panel.querySelector('.q-sidebar-document-item__title')?.textContent).toBe('Target');

    act(() => {
      outgoingButton.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });
    expect(mounted.onOpenOutgoing).toHaveBeenCalledWith(linkMocks.outgoing, 'new-tab');
    expect(mounted.onOpenBacklink).not.toHaveBeenCalled();
  });

  it('shows a loading indicator instead of an empty panel', () => {
    localStorage.setItem('obsidium_backlinks_mode', JSON.stringify('backlinks'));
    linkState.backlinks = null;
    linkState.loading = true;
    const mounted = mountPanel();
    renderer = mounted.renderer;

    const status = mounted.panel.querySelector('.q-backlinks__status');
    expect(status).not.toBeNull();
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(status?.querySelector('.q-backlinks__spinner')).not.toBeNull();
    expect(status?.textContent).toBe('backlinks.loading');
    expect(mounted.panel.querySelector('.q-panel-empty')).toBeNull();
  });

  it('shows the empty state when the settled link result has no rows', () => {
    localStorage.setItem('obsidium_backlinks_mode', JSON.stringify('backlinks'));
    linkState.backlinks = [];
    linkState.loading = false;
    const mounted = mountPanel();
    renderer = mounted.renderer;

    expect(mounted.panel.querySelector('.q-panel-empty')?.textContent).toBe('backlinks.empty');
    expect(mounted.panel.querySelector('.q-sidebar-document-item')).toBeNull();
  });
});
