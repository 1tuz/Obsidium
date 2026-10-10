// @vitest-environment happy-dom
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../i18n';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { DEFAULT_PREFERENCES } from './graphDisplay';
import { GraphSettings } from './GraphSettings';
import type { GraphPathState } from './renderer';

const PATH_CONTROLS = {
  pathMode: false,
  pathState: { status: 'idle' } as GraphPathState,
  onPathModeChange: () => {},
  onClearPath: () => {},
};

const DEFAULT_CONTROLS = {
  ...DEFAULT_PREFERENCES,
  createdShare: 0,
  modifiedShare: 0,
  createdBeforeShare: 1,
  modifiedBeforeShare: 1,
  folderFilter: '',
  tagFilter: '',
  propertyKeyFilter: '',
  propertyValueFilter: '',
};

describe('GraphSettings', () => {
  let renderer: MountedDom | null = null;

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
  });

  it('collapses to a compact control and restores graph settings', () => {
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={() => {}}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const panel = renderer!.container.querySelector('aside')!;
    expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(14);
    const collapse = panel.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.collapseSettings')}"]`,
    );
    expect(collapse).not.toBeNull();

    act(() => collapse!.click());

    const expand = panel.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.expandSettings')}"]`,
    );
    expect(expand?.getAttribute('aria-expanded')).toBe('false');
    expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(0);

    act(() => expand!.click());

    expect(panel.querySelectorAll('input[type="range"]')).toHaveLength(14);
    expect(panel.querySelector(`[aria-label="${t('graph.collapseSettings')}"]`))
      .not.toBeNull();
  });

  it('selects layout modes and exposes force controls only for force layout', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const layout = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.layoutMode')}"]`,
    )!;
    act(() => layout.click());
    const ringOption = [...document.querySelectorAll('[role="option"]')]
      .find((option) => option.textContent === t('graph.layoutRing'))!;
    act(() => (ringOption as HTMLElement).click());
    expect(onChange).toHaveBeenCalledWith({ layoutMode: 'ring' });

    const row = [...renderer!.container.querySelectorAll('.q-slider')]
      .find((item) => item.textContent?.includes(t('graph.attraction')))!;
    const input = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    input.value = '1.4';
    act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith({ attraction: 1.4 });

    act(() => renderer!.update(
      <GraphSettings
        {...PATH_CONTROLS}
        controls={{ ...DEFAULT_CONTROLS, layoutMode: 'ring' }}
        range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
        onChange={onChange}
        onRefresh={() => {}}
        presets={{}}
        onSavePreset={() => {}}
        onApplyPreset={() => {}}
        onDeletePreset={() => {}}
      />,
    ));
    expect([...renderer!.container.querySelectorAll('.q-slider')]
      .some((item) => item.textContent?.includes(t('graph.attraction')))).toBe(false);
  });

  it('shows suggestion methods and asks the caller to confirm a candidate', () => {
    const onChange = vi.fn();
    const onCreateSuggestedLink = vi.fn();
    const suggestion = {
      path: '/vault/Notes/Related.md',
      title: 'Related',
      rawScore: 1,
      reasons: ['shared neighbor'],
    };
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={{ ...DEFAULT_CONTROLS, suggestionsEnabled: true }}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
          suggestions={[suggestion]}
          onCreateSuggestedLink={onCreateSuggestedLink}
        />,
      );
    });

    expect(renderer!.container.textContent).toContain('Related');
    const method = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.suggestionMethod')}"]`,
    );
    expect(method).not.toBeNull();
    act(() => method!.click());
    const lexicalSearch = [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent === t('analysis.methods.bm25f'));
    expect(lexicalSearch).not.toBeNull();
    act(() => lexicalSearch!.click());
    expect(onChange).toHaveBeenCalledWith({ suggestionMethod: 'bm25f' });
    const linkButton = [...renderer!.container.querySelectorAll('button')]
      .find((button) => button.textContent === t('graph.createSuggestedLink'));
    expect(linkButton).not.toBeNull();
    act(() => linkButton!.click());
    expect(onCreateSuggestedLink).toHaveBeenCalledWith(suggestion);
  });

  it('saves, applies, and deletes named presets', () => {
    const save = vi.fn();
    const apply = vi.fn();
    const remove = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={() => {}}
          onRefresh={() => {}}
          presets={{ Research: DEFAULT_PREFERENCES }}
          onSavePreset={(name) => { save(name); }}
          onApplyPreset={(name) => { apply(name); }}
          onDeletePreset={(name) => { remove(name); }}
        />,
      );
    });
    const name = renderer!.container.querySelector<HTMLInputElement>('#q-graph-preset-name')!;
    name.value = 'Reading';
    act(() => { name.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => {
      renderer!.container.querySelector('form')!.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      );
    });

    const preset = renderer!.container.querySelector<HTMLButtonElement>(
      '.q-graph-settings-preset > button',
    )!;
    act(() => preset.click());
    const deleteButton = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.deletePreset', { name: 'Research' })}"]`,
    )!;
    act(() => deleteButton.click());

    expect(save).toHaveBeenCalledWith('Reading');
    expect(apply).toHaveBeenCalledWith('Research');
    expect(remove).toHaveBeenCalledWith('Research');
  });

  it('shows community names from their most connected note', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
          communities={[{ id: 2, count: 7, node: 5, stableId: '31:9', name: 'Knowledge graph' }]}
        />,
      );
    });
    expect(renderer!.container.querySelector('.q-graph-settings-communities legend')?.textContent)
      .toBe(t('graph.communities'));
    const input = renderer!.container.querySelector<HTMLInputElement>(
      `[aria-label="${t('graph.renameCommunity', { name: 'Knowledge graph' })}"]`,
    )!;
    expect(input.value).toBe('Knowledge graph');
    input.value = 'Projects';
    act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith({ communityNames: { '31:9': 'Projects' } });
  });

  it('toggles a community collapse preference by its stable representative ID', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={{ ...DEFAULT_CONTROLS, collapsedCommunities: {} }}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
          communities={[{ id: 2, count: 7, node: 5, stableId: '31:9', name: 'Knowledge graph' }]}
        />,
      );
    });

    const toggle = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.collapseCommunity', { name: 'Knowledge graph' })}"]`,
    )!;
    act(() => toggle.click());

    expect(onChange).toHaveBeenCalledWith({ collapsedCommunities: { '31:9': true } });
  });

  it('uses the owner page after the settings panel remounts', () => {
    let page = 0;
    const communities = [{ id: 12, count: 1, node: 12, stableId: '12:0', name: 'Cluster 13' }];
    const render = () => (
      <GraphSettings
        {...PATH_CONTROLS}
        controls={DEFAULT_CONTROLS}
        range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
        onChange={() => {}}
        onRefresh={() => {}}
        presets={{}}
        onSavePreset={() => {}}
        onApplyPreset={() => {}}
        onDeletePreset={() => {}}
        communities={communities}
        communityCount={14}
        communityPage={page}
        onCommunityPageChange={(nextPage) => { page = nextPage; }}
      />
    );

    act(() => { renderer = mountDom(render()); });
    const next = renderer!.container.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.communityNext')}"]`,
    )!;
    act(() => next.click());
    act(() => renderer!.update(render()));
    expect(renderer!.container.textContent).toContain(t('graph.communityPageRange', {
      from: 13,
      to: 14,
      total: 14,
    }));

    act(() => renderer!.unmount());
    act(() => { renderer = mountDom(render()); });
    expect(renderer!.container.textContent).toContain(t('graph.communityPageRange', {
      from: 13,
      to: 14,
      total: 14,
    }));
  });

  it('renames and collapses a community beyond the first page', () => {
    const onChange = vi.fn();
    let page = 0;
    const communities = Array.from({ length: 13 }, (_, id) => ({
      id,
      count: 20 - id,
      node: id,
      stableId: `4:${id + 100}`,
      name: `Community ${id + 1}`,
    }));
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
          communities={communities.slice(page * 12, (page + 1) * 12)}
          communityCount={communities.length}
          communityPage={page}
          onCommunityPageChange={(nextPage) => { page = nextPage; }}
        />,
      );
    });

    const panel = renderer!.container.querySelector<HTMLElement>('.q-graph-settings-communities')!;
    expect(panel.querySelectorAll(':scope > .q-graph-settings-community')).toHaveLength(12);
    const next = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.getAttribute('aria-label') === t('graph.communityNext'))!;
    act(() => next.click());
    act(() => renderer!.update(
      <GraphSettings
        {...PATH_CONTROLS}
        controls={DEFAULT_CONTROLS}
        range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
        onChange={onChange}
        onRefresh={() => {}}
        presets={{}}
        onSavePreset={() => {}}
        onApplyPreset={() => {}}
        onDeletePreset={() => {}}
        communities={communities.slice(page * 12, (page + 1) * 12)}
        communityCount={communities.length}
        communityPage={page}
        onCommunityPageChange={(nextPage) => { page = nextPage; }}
      />,
    ));
    expect(panel.querySelectorAll(':scope > .q-graph-settings-community')).toHaveLength(1);

    const input = panel.querySelector<HTMLInputElement>(
      `[aria-label="${t('graph.renameCommunity', { name: 'Community 13' })}"]`,
    )!;
    input.value = 'Archive';
    act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    const collapse = panel.querySelector<HTMLButtonElement>(
      `[aria-label="${t('graph.collapseCommunity', { name: 'Community 13' })}"]`,
    )!;
    act(() => collapse.click());

    expect(onChange).toHaveBeenCalledWith({ communityNames: { '4:112': 'Archive' } });
    expect(onChange).toHaveBeenCalledWith({ collapsedCommunities: { '4:112': true } });
  });

  it('toggles orphan highlighting', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const row = [...renderer!.container.querySelectorAll('.q-graph-settings-toggle')]
      .find((item) => item.textContent === t('graph.orphans'))!;
    const toggle = row.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    act(() => toggle.click());

    expect(onChange).toHaveBeenCalledWith({ orphanHighlight: true });
  });

  it('changes the local graph depth from the depth control', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });
    const control = [...renderer!.container.querySelectorAll<HTMLInputElement>('input[type="range"]')]
      .find((input) => input.parentElement?.textContent?.includes(t('graph.localDepth')))!;
    control.value = '4';
    act(() => { control.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { control.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith({ localGraphDepth: 4 });
  });

  it('toggles secondary island highlighting', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const row = [...renderer!.container.querySelectorAll('.q-graph-settings-toggle')]
      .find((item) => item.textContent === t('graph.islands'))!;
    const toggle = row.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    act(() => toggle.click());

    expect(onChange).toHaveBeenCalledWith({ islandHighlight: true });
  });

  it('toggles the PageRank highlight', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const row = [...renderer!.container.querySelectorAll('.q-graph-settings-toggle')]
      .find((item) => item.textContent === t('graph.importantNodes'))!;
    const toggle = row.querySelector<HTMLButtonElement>('button[role="switch"]')!;
    act(() => toggle.click());

    expect(onChange).toHaveBeenCalledWith({ importantNodes: true });
  });

  it('toggles Louvain community colors', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const row = [...renderer!.container.querySelectorAll('.q-graph-settings-toggle')]
      .find((item) => item.textContent === t('graph.communityColors'))!;
    act(() => row.querySelector<HTMLButtonElement>('button[role="switch"]')!.click());

    expect(onChange).toHaveBeenCalledWith({ communityColors: true });
  });

  it('adds a persisted metadata color rule', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const button = [...renderer!.container.querySelectorAll('button')]
      .find((item) => item.textContent === t('graph.addGroup'))!;
    act(() => button.click());

    expect(onChange).toHaveBeenCalledWith({
      groupRules: [expect.objectContaining({ field: 'folder', value: '', color: 'cold' })],
    });
  });

  it('sets and clears an optional custom color on a group rule', () => {
    const onChange = vi.fn();
    const rule = { id: 'tag', field: 'tag' as const, key: '', value: 'research', color: 'cold' as const };
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={{ ...DEFAULT_CONTROLS, groupRules: [rule] }}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const color = renderer!.container.querySelector<HTMLInputElement>(
      '.q-graph-settings-groups input[type="color"]',
    )!;
    color.value = '#1471eb';
    act(() => { color.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(onChange).toHaveBeenCalledWith({
      groupRules: [{ ...rule, customColor: '#1471eb' }],
    });

    act(() => renderer!.update(
      <GraphSettings
        {...PATH_CONTROLS}
        controls={{ ...DEFAULT_CONTROLS, groupRules: [{ ...rule, customColor: '#1471eb' }] }}
        range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
        onChange={onChange}
        onRefresh={() => {}}
        presets={{}}
        onSavePreset={() => {}}
        onApplyPreset={() => {}}
        onDeletePreset={() => {}}
      />,
    ));

    const reset = [...renderer!.container.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.groupUseThemeColor'));
    expect(reset).not.toBeNull();
    act(() => reset!.click());
    expect(onChange).toHaveBeenLastCalledWith({
      groupRules: [{ ...rule, customColor: null }],
    });
  });

  it('changes Louvain community resolution', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const row = [...renderer!.container.querySelectorAll('.q-slider')]
      .find((item) => item.textContent?.includes(t('graph.communityResolution')))!;
    const input = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    input.value = '1.8';
    act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });

    expect(onChange).toHaveBeenCalledWith({ communityResolution: 1.8 });
  });

  it('changes the label density setting', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const row = [...renderer!.container.querySelectorAll('.q-slider')]
      .find((item) => item.textContent?.includes(t('graph.labelDensity')))!;
    const input = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    input.value = '0.5';
    act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });

    expect(onChange).toHaveBeenCalledWith({ labelDensity: 0.5 });
  });

  it('shows and saves a custom edge color only when custom mode is selected', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    expect(renderer!.container.querySelector('input[type="color"]')).toBeNull();
    const custom = [...renderer!.container.querySelectorAll<HTMLButtonElement>('.q-segmented-control__button')]
      .find((button) => button.textContent === t('graph.edgeCustom'))!;
    act(() => custom.click());
    expect(onChange).toHaveBeenCalledWith({ edgeColor: 'custom' });

    act(() => renderer!.update(
      <GraphSettings
        {...PATH_CONTROLS}
        controls={{ ...DEFAULT_CONTROLS, edgeColor: 'custom' }}
        range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
        onChange={onChange}
        onRefresh={() => {}}
        presets={{}}
        onSavePreset={() => {}}
        onApplyPreset={() => {}}
        onDeletePreset={() => {}}
      />,
    ));
    const color = renderer!.container.querySelector<HTMLInputElement>('input[type="color"]')!;
    color.value = '#1471eb';
    act(() => { color.dispatchEvent(new Event('input', { bubbles: true })); });

    expect(onChange).toHaveBeenLastCalledWith({ edgeCustomColor: '#1471eb' });
  });

  it('changes the modification date threshold', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 100, modifiedNewest: 200 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const row = [...renderer!.container.querySelectorAll('.q-slider')]
      .find((item) => item.textContent?.includes(t('graph.modifiedAfter')))!;
    const input = row.querySelector<HTMLInputElement>('input[type="range"]')!;
    input.value = '0.5';
    act(() => { input.dispatchEvent(new Event('input', { bubbles: true })); });

    expect(onChange).toHaveBeenCalledWith({ modifiedShare: 0.5 });
  });

  it('changes the creation and modification upper date bounds', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 10, newest: 30, modifiedOldest: 100, modifiedNewest: 200 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const rows = [...renderer!.container.querySelectorAll('.q-slider')];
    const created = rows.find((item) => item.textContent?.includes(t('graph.createdBefore')))!;
    const modified = rows.find((item) => item.textContent?.includes(t('graph.modifiedBefore')))!;
    const createdInput = created.querySelector<HTMLInputElement>('input[type="range"]')!;
    const modifiedInput = modified.querySelector<HTMLInputElement>('input[type="range"]')!;
    createdInput.value = '0.5';
    modifiedInput.value = '0.25';
    act(() => { createdInput.dispatchEvent(new Event('input', { bubbles: true })); });
    act(() => { modifiedInput.dispatchEvent(new Event('input', { bubbles: true })); });

    expect(onChange).toHaveBeenNthCalledWith(1, { createdBeforeShare: 0.5 });
    expect(onChange).toHaveBeenNthCalledWith(2, { modifiedBeforeShare: 0.25 });
  });

  it('passes folder, tag, and property filters to the graph view', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const fields = renderer!.container.querySelectorAll<HTMLInputElement>(
      '.q-graph-settings-filters input',
    );
    fields[0].value = 'Projects/';
    act(() => { fields[0].dispatchEvent(new Event('input', { bubbles: true })); });
    fields[1].value = 'research';
    act(() => { fields[1].dispatchEvent(new Event('input', { bubbles: true })); });
    fields[2].value = 'type';
    act(() => { fields[2].dispatchEvent(new Event('input', { bubbles: true })); });

    expect(onChange).toHaveBeenNthCalledWith(1, { folderFilter: 'Projects/' });
    expect(onChange).toHaveBeenNthCalledWith(2, { tagFilter: 'research' });
    expect(onChange).toHaveBeenNthCalledWith(3, { propertyKeyFilter: 'type' });
  });

  it('filters graph links by their indexed type', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const group = [...renderer!.container.querySelectorAll('.q-graph-settings-choice')]
      .find((item) => item.textContent?.includes(t('graph.edgeType')))!;
    const trigger = group.querySelector<HTMLButtonElement>('.q-dropdown__trigger')!;
    act(() => trigger.click());
    const wiki = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((button) => button.textContent === t('graph.edgeTypeWiki'))!;
    act(() => wiki.click());

    expect(onChange).toHaveBeenCalledWith({ edgeType: 'wiki' });
  });

  it('filters incoming or outgoing links relative to the selected note', () => {
    const onChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={onChange}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const group = [...renderer!.container.querySelectorAll('.q-graph-settings-choice')]
      .find((item) => item.textContent?.includes(t('graph.edgeDirection')))!;
    act(() => group.querySelector<HTMLButtonElement>('.q-dropdown__trigger')!.click());
    const outgoing = [...document.body.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((button) => button.textContent === t('graph.edgeDirectionOutgoing'))!;
    act(() => outgoing.click());

    expect(onChange).toHaveBeenCalledWith({ edgeDirection: 'outgoing' });
  });

  it('starts a path selection session and displays its result', () => {
    const onPathModeChange = vi.fn();
    act(() => {
      renderer = mountDom(
        <GraphSettings
          {...PATH_CONTROLS}
          pathState={{ status: 'found', nodeCount: 3 }}
          onPathModeChange={onPathModeChange}
          controls={DEFAULT_CONTROLS}
          range={{ oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 }}
          onChange={() => {}}
          onRefresh={() => {}}
          presets={{}}
          onSavePreset={() => {}}
          onApplyPreset={() => {}}
          onDeletePreset={() => {}}
        />,
      );
    });

    const panel = renderer!.container.querySelector('aside')!;
    const start = [...panel.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === t('graph.findPath'))!;
    act(() => start.click());

    expect(onPathModeChange).toHaveBeenCalledWith(true);
    expect(panel.textContent).toContain(t('graph.pathFound', { count: 3 }));
  });
});
