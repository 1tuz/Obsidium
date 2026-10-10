// @vitest-environment happy-dom
import { useRef } from 'react';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { DEFAULT_PREFERENCES } from './graphDisplay';
import { useGraphControls } from './useGraphControls';

const graphMocks = vi.hoisted(() => ({
  config: { graph: null as unknown },
  legacy: {} as Record<string, unknown>,
  loadFilterNodes: vi.fn(async (_workspace: string, _epoch: unknown, _filter: unknown) => [] as number[]),
  loadClusterIds: vi.fn(async () => [] as number[]),
  updateConfig: vi.fn(async (_config: unknown) => undefined),
}));

vi.mock('../../modules/graph', () => ({
  loadGraphFilterNodes: graphMocks.loadFilterNodes,
  loadGraphClusterIds: graphMocks.loadClusterIds,
}));

vi.mock('../../modules/settings', () => ({
  useSettingsStore: () => ({
    config: graphMocks.config,
    loadConfig: vi.fn(async () => graphMocks.config),
    updateConfig: graphMocks.updateConfig,
  }),
}));

vi.mock('../../modules/workspace/uiPersist', () => ({
  useLocalState: (key: string, fallback: unknown) => [graphMocks.legacy[key] ?? fallback, vi.fn()],
}));

function ControlsHarness() {
  const controls = useGraphControls(
    useRef(null),
    0,
    null,
    { oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 },
    null,
  );

  return (
    <div>
      <span>{controls.controls.nodeSize}</span>
      <button onClick={() => controls.patchControls({
        nodeSize: 1.7,
        createdBeforeShare: 0.75,
        modifiedBeforeShare: 0.8,
        edgeColor: 'custom',
        edgeCustomColor: '#1471eb',
        groupRules: [{
          id: 'research', field: 'tag', key: '', value: 'research', color: 'cold', customColor: '#e46a2a',
        }],
        communityNames: { '21:34': 'Research' },
        collapsedCommunities: { '21:34': true },
      })}>change</button>
      <button onClick={() => controls.savePreset('Research')}>save</button>
    </div>
  );
}

const colorRenderer = {
  applyDisplay: vi.fn(),
  setCommunityIds: vi.fn(),
  setCustomGroupIds: vi.fn(),
  setCustomGroupRules: vi.fn(),
  setIncludedNodes: vi.fn(),
};
const groupCounts = { nodeCount: 3, edgeCount: 0, epoch: { low: 1, high: 0 } };

function GroupRulesHarness() {
  const renderer = useRef(colorRenderer as never);
  const controls = useGraphControls(
    renderer,
    1,
    groupCounts,
    { oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 },
    '/vault',
  );

  return (
    <div>
      <button onClick={() => controls.patchControls({
        groupRules: [{ id: 'tag', field: 'tag', key: '', value: 'new', color: 'hot' }],
      })}>edit rule</button>
      <button onClick={() => controls.patchControls({
        groupRules: [{
          id: 'tag', field: 'tag', key: '', value: 'new', color: 'hot', customColor: '#1471eb',
        }],
      })}>change group color</button>
    </div>
  );
}

function PresetHarness() {
  const controls = useGraphControls(
    useRef(null),
    0,
    null,
    { oldest: 0, newest: 1, modifiedOldest: 0, modifiedNewest: 1 },
    null,
  );

  return (
    <div>
      <output>{JSON.stringify({ controls: controls.controls, presets: controls.presets })}</output>
      <button onClick={() => controls.patchControls({
        createdShare: 0.25,
        modifiedShare: 0.75,
        createdBeforeShare: 0.6,
        modifiedBeforeShare: 0.8,
        folderFilter: 'projects',
        tagFilter: '#research',
        propertyKeyFilter: 'status',
        propertyValueFilter: 'active',
      })}>select filters</button>
      <button onClick={() => controls.patchControls({
        createdShare: 0.5,
        modifiedShare: 0.5,
        createdBeforeShare: 0.9,
        modifiedBeforeShare: 0.95,
        folderFilter: 'other',
        tagFilter: '#other',
        propertyKeyFilter: 'kind',
        propertyValueFilter: 'draft',
      })}>change filters</button>
      <button onClick={() => controls.savePreset('Research')}>save preset</button>
      <button onClick={() => controls.applyPreset('Research')}>apply preset</button>
      <button onClick={() => controls.applyPreset('Legacy')}>apply legacy</button>
    </div>
  );
}

describe('useGraphControls persistence', () => {
  let renderer: MountedDom | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    graphMocks.config = {
      graph: {
        preferences: { ...DEFAULT_PREFERENCES, nodeSize: 1.3 },
        presets: {},
      },
    };
    graphMocks.legacy = {};
    graphMocks.loadFilterNodes.mockReset();
    graphMocks.loadFilterNodes.mockResolvedValue([]);
    graphMocks.loadClusterIds.mockReset();
    graphMocks.loadClusterIds.mockResolvedValue([]);
    colorRenderer.setCustomGroupIds.mockClear();
    colorRenderer.setCustomGroupRules.mockClear();
    graphMocks.updateConfig.mockClear();
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = null;
    vi.useRealTimers();
  });

  it('loads settings and persists preference changes after a short debounce', () => {
    act(() => { renderer = mountDom(<ControlsHarness />); });

    expect(renderer!.container.textContent).toContain('1.3');
    act(() => renderer!.container.querySelectorAll('button')[0].click());
    act(() => renderer!.container.querySelectorAll('button')[1].click());
    act(() => { vi.advanceTimersByTime(351); });

    const saved = graphMocks.updateConfig.mock.calls[0]?.[0] as {
      graph: { preferences: { nodeSize: number; createdBeforeShare: number; modifiedBeforeShare: number; edgeColor: string; edgeCustomColor: string | null; groupRules: Array<{ customColor?: string | null }>; communityNames: Record<string, string>; collapsedCommunities: Record<string, boolean> }; presets: Record<string, { edgeColor: string; edgeCustomColor: string | null; createdBeforeShare: number; modifiedBeforeShare: number; groupRules: Array<{ customColor?: string | null }> }> };
    };
    expect(saved.graph.preferences.nodeSize).toBe(1.7);
    expect(saved.graph.preferences.createdBeforeShare).toBe(0.75);
    expect(saved.graph.preferences.modifiedBeforeShare).toBe(0.8);
    expect(saved.graph.preferences.edgeColor).toBe('custom');
    expect(saved.graph.preferences.edgeCustomColor).toBe('#1471eb');
    expect(saved.graph.preferences.groupRules[0].customColor).toBe('#e46a2a');
    expect(saved.graph.preferences.communityNames).toEqual({ '21:34': 'Research' });
    expect(saved.graph.preferences.collapsedCommunities).toEqual({ '21:34': true });
    expect(saved.graph.presets).toHaveProperty('Research');
    expect(saved.graph.presets.Research).toMatchObject({
      edgeColor: 'custom',
      edgeCustomColor: '#1471eb',
      createdBeforeShare: 0.75,
      modifiedBeforeShare: 0.8,
      groupRules: [expect.objectContaining({ customColor: '#e46a2a' })],
    });
  });

  it('migrates existing graph settings and presets into app settings', () => {
    graphMocks.config = { graph: { preferences: null, presets: null } };
    graphMocks.legacy = {
      aquilum_graph_preferences: { ...DEFAULT_PREFERENCES, nodeSize: 1.4 },
      aquilum_graph_presets: { Research: DEFAULT_PREFERENCES },
    };

    act(() => { renderer = mountDom(<ControlsHarness />); });
    act(() => { vi.advanceTimersByTime(351); });

    const saved = graphMocks.updateConfig.mock.calls[0]?.[0] as {
      graph: { preferences: { nodeSize: number }; presets: Record<string, unknown> };
    };
    expect(saved.graph.preferences.nodeSize).toBe(1.4);
    expect(saved.graph.presets).toHaveProperty('Research');
  });

  it('saves and restores metadata and date filters while keeping legacy presets compatible', () => {
    graphMocks.config = {
      graph: {
        preferences: DEFAULT_PREFERENCES,
        presets: { Legacy: { ...DEFAULT_PREFERENCES, nodeSize: 1.4 } },
      },
    };
    act(() => { renderer = mountDom(<PresetHarness />); });
    const button = (label: string) => [...renderer!.container.querySelectorAll('button')]
      .find((candidate) => candidate.textContent === label)!;
    const output = () => JSON.parse(renderer!.container.querySelector('output')!.textContent!);

    act(() => button('select filters').click());
    act(() => button('save preset').click());
    expect(output().presets.Research).toMatchObject({
      createdShare: 0.25,
      modifiedShare: 0.75,
      createdBeforeShare: 0.6,
      modifiedBeforeShare: 0.8,
      folderFilter: 'projects',
      tagFilter: '#research',
      propertyKeyFilter: 'status',
      propertyValueFilter: 'active',
    });

    act(() => button('change filters').click());
    act(() => button('apply preset').click());
    expect(output().controls).toMatchObject({
      createdShare: 0.25,
      modifiedShare: 0.75,
      createdBeforeShare: 0.6,
      modifiedBeforeShare: 0.8,
      folderFilter: 'projects',
      tagFilter: '#research',
      propertyKeyFilter: 'status',
      propertyValueFilter: 'active',
    });

    act(() => button('apply legacy').click());
    expect(output().controls).toMatchObject({
      createdShare: 0.25,
      modifiedShare: 0.75,
      folderFilter: 'projects',
      tagFilter: '#research',
      propertyKeyFilter: 'status',
      propertyValueFilter: 'active',
    });
  });

  it('debounces metadata color rules and keeps applied colors until the new query settles', async () => {
    graphMocks.config = {
      graph: {
        preferences: {
          ...DEFAULT_PREFERENCES,
          groupRules: [{ id: 'folder', field: 'folder', key: '', value: 'old', color: 'cold' }],
        },
        presets: {},
      },
    };
    let resolveQuery!: (nodes: number[]) => void;
    graphMocks.loadFilterNodes.mockImplementation(async () => new Promise<number[]>((resolve) => {
      resolveQuery = resolve;
    }));
    act(() => { renderer = mountDom(<GroupRulesHarness />); });

    act(() => { vi.advanceTimersByTime(180); });
    expect(graphMocks.loadFilterNodes).toHaveBeenCalledTimes(1);
    expect(colorRenderer.setCustomGroupIds).not.toHaveBeenCalled();
    await act(async () => {
      resolveQuery([0, 1]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect([...colorRenderer.setCustomGroupIds.mock.calls[0][0]]).toEqual([1, 1, 0]);

    act(() => renderer!.container.querySelector('button')!.click());
    expect(colorRenderer.setCustomGroupIds).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(179); });
    expect(graphMocks.loadFilterNodes).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(1); });
    expect(graphMocks.loadFilterNodes).toHaveBeenCalledTimes(2);
    expect(colorRenderer.setCustomGroupIds).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveQuery([2]);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect([...colorRenderer.setCustomGroupIds.mock.calls[1][0]]).toEqual([0, 0, 1]);

    act(() => renderer!.container.querySelectorAll('button')[1].click());
    act(() => { vi.advanceTimersByTime(180); });
    expect(graphMocks.loadFilterNodes).toHaveBeenCalledTimes(2);
    expect(colorRenderer.setCustomGroupIds).toHaveBeenCalledTimes(2);
    expect(colorRenderer.setCustomGroupRules).toHaveBeenLastCalledWith([
      expect.objectContaining({ value: 'new', color: 'hot', customColor: '#1471eb' }),
    ]);
  });
});
