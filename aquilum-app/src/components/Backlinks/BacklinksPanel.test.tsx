import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  analysis: {
    path: 'C:\\notes\\Related.md',
    title: 'Related',
    rawScore: 0.255,
    reasons: ['related'],
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../i18n', () => ({ t: (key: string) => key }));
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
    result: mode === 'backlinks'
      ? { mode, items: [linkMocks.backlink] }
      : { mode, items: [linkMocks.outgoing] },
    loading: false,
  }),
}));
vi.mock('../../modules/analysis', () => ({
  enabledSidebarMethods: () => ['bm25f', 'adamicAdar', 'wixiv'],
  isGraphAnalysisMethod: (method: string) => method !== 'wixiv',
  useDocumentAnalysis: () => ({
    items: [linkMocks.analysis],
    failed: false,
    loading: false,
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

describe('BacklinksPanel', () => {
  let renderer: ReactTestRenderer | null = null;

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {}
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('switches the pressed mode and renders document-name rows', () => {
    const onOpenBacklink = vi.fn();
    const onOpenOutgoing = vi.fn();
    const onOpenAnalysis = vi.fn();
    act(() => {
      renderer = create(
        <BacklinksPanel
          workspacePath="C:\\notes"
          documentPath="C:\\notes\\Current.md"
          activeTabId={null}
          indexReady
          indexRevision={1}
          isOpen
          onOpenBacklink={onOpenBacklink}
          onOpenOutgoing={onOpenOutgoing}
          onOpenAnalysis={onOpenAnalysis}
        />,
      );
    });

    const modeButtons = renderer!.root.findAllByProps({
      className: 'q-icon-button q-icon-button--medium q-backlinks__mode-button',
    });
    expect(modeButtons.map((button) => button.props['aria-pressed'])).toEqual([true, false, false, false]);
    expect(renderer!.root.findByType('h2').children).toEqual(['backlinks.mentionsTitle']);
    expect(renderer!.root.findByProps({ className: 'q-sidebar-document-item__title' }).children).toEqual(['Source']);

    act(() => modeButtons[1].props.onClick());

    expect(modeButtons.map((button) => button.props['aria-pressed'])).toEqual([false, true, false, false]);
    expect(renderer!.root.findByType('h2').children).toEqual(['backlinks.outgoingTitle']);
    const outgoingButton = renderer!.root.findByProps({ className: 'q-sidebar-document-item' });
    expect(renderer!.root.findByProps({ className: 'q-sidebar-document-item__title' }).children).toEqual(['Target']);

    act(() => outgoingButton.props.onClick({ ctrlKey: true, metaKey: false }));
    expect(onOpenOutgoing).toHaveBeenCalledWith(linkMocks.outgoing, 'new-tab');
    expect(onOpenBacklink).not.toHaveBeenCalled();
  });
});
