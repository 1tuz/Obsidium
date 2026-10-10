import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { DEFAULT_PREFERENCES, type GraphPreferences, type GraphPresets } from './graphDisplay';
import type { GraphControls } from './GraphSettings';
import type { GraphDateRange, GraphRenderer } from './renderer';
import type { GraphCounts } from './useGraphSnapshot';
import { useLocalState } from '../../modules/workspace/uiPersist';
import { loadGraphClusterIds, loadGraphFilterNodes } from '../../modules/graph';
import type { GraphEpoch } from '../../modules/graph';
import { useSettingsStore } from '../../modules/settings';
import { customGroupIds } from './customGroupIds';

type GroupRuleFilter = Pick<GraphPreferences['groupRules'][number], 'field' | 'key' | 'value'>;

export function useGraphControls(
  rendererRef: RefObject<GraphRenderer | null>,
  generation: number,
  counts: GraphCounts | null,
  range: GraphDateRange,
  workspacePath: string | null,
) {
  const previousWorkspace = useRef(workspacePath);
  const [legacyPreferences] = useLocalState<GraphPreferences>(
    'aquilum_graph_preferences',
    DEFAULT_PREFERENCES,
  );
  const [legacyPresets] = useLocalState<GraphPresets>('aquilum_graph_presets', {});
  const { config, loadConfig, updateConfig } = useSettingsStore();
  const [graphSettingsLoaded, setGraphSettingsLoaded] = useState(false);
  const [storedPreferences, setPreferences] = useState(DEFAULT_PREFERENCES);
  const [presets, setPresets] = useState<GraphPresets>({});
  const preferences = useMemo(
    () => ({ ...DEFAULT_PREFERENCES, ...storedPreferences }),
    [storedPreferences],
  );
  const groupRuleFilterKey = JSON.stringify(preferences.groupRules.filter((rule) => rule.value.trim()
    && (rule.field !== 'property' || rule.key.trim())).map(({ field, key, value }) => ({
    field,
    key: key.trim(),
    value: value.trim(),
  })));
  const groupRuleFilters = useMemo<GroupRuleFilter[]>(
    () => JSON.parse(groupRuleFilterKey) as GroupRuleFilter[],
    [groupRuleFilterKey],
  );

  useEffect(() => {
    if (!config) void loadConfig();
  }, [config, loadConfig]);

  useEffect(() => {
    if (!config || graphSettingsLoaded) return;
    setPreferences({
      ...DEFAULT_PREFERENCES,
      ...(config.graph?.preferences ?? legacyPreferences),
    });
    setPresets(config.graph?.presets ?? legacyPresets);
    setGraphSettingsLoaded(true);
  }, [config, graphSettingsLoaded, legacyPreferences, legacyPresets]);

  useEffect(() => {
    if (!config || !graphSettingsLoaded) return;
    const nextGraph = { preferences, presets };
    if (JSON.stringify(config.graph) === JSON.stringify(nextGraph)) return;
    const timer = window.setTimeout(() => {
      void updateConfig({ ...config, graph: nextGraph }).catch((error) => {
        console.error('Failed to save graph settings', error);
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [config, graphSettingsLoaded, preferences, presets, updateConfig]);
  const [createdShare, setCreatedShare] = useState(0);
  const [modifiedShare, setModifiedShare] = useState(0);
  const [folderFilter, setFolderFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [propertyKeyFilter, setPropertyKeyFilter] = useState('');
  const [propertyValueFilter, setPropertyValueFilter] = useState('');
  const [filterStatus, setFilterStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [communityData, setCommunityData] = useState<{ epoch: GraphEpoch; ids: Uint32Array } | null>(null);
  const controls = useMemo<GraphControls>(
    () => ({
      ...preferences,
      createdShare,
      modifiedShare,
      folderFilter,
      tagFilter,
      propertyKeyFilter,
      propertyValueFilter,
    }),
    [preferences, createdShare, modifiedShare, folderFilter, tagFilter, propertyKeyFilter, propertyValueFilter],
  );

  useEffect(() => {
    if (previousWorkspace.current === workspacePath) return;
    previousWorkspace.current = workspacePath;
    setCreatedShare(0);
    setModifiedShare(0);
    setFolderFilter('');
    setTagFilter('');
    setPropertyKeyFilter('');
    setPropertyValueFilter('');
    setFilterStatus('idle');
  }, [workspacePath]);

  useEffect(() => {
    rendererRef.current?.applyDisplay({
      ...preferences,
      createdFrom: createdShare === 0
        ? Number.NEGATIVE_INFINITY
        : range.oldest + (range.newest - range.oldest) * createdShare,
      createdTo: preferences.createdBeforeShare === 1
        ? Number.POSITIVE_INFINITY
        : range.oldest + (range.newest - range.oldest) * preferences.createdBeforeShare,
      modifiedFrom: modifiedShare === 0
        ? Number.NEGATIVE_INFINITY
        : range.modifiedOldest + (range.modifiedNewest - range.modifiedOldest) * modifiedShare,
      modifiedTo: preferences.modifiedBeforeShare === 1
        ? Number.POSITIVE_INFINITY
        : range.modifiedOldest
          + (range.modifiedNewest - range.modifiedOldest) * preferences.modifiedBeforeShare,
    });
  }, [
    counts,
    createdShare,
    generation,
    modifiedShare,
    preferences,
    range.modifiedNewest,
    range.modifiedOldest,
    range.newest,
    range.oldest,
    rendererRef,
  ]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!graphSettingsLoaded || !renderer || !counts || !workspacePath) return;
    let current = true;
    setCommunityData(null);
    const timer = window.setTimeout(() => {
      void loadGraphClusterIds(workspacePath, counts.epoch, preferences.communityResolution)
        .then((ids) => {
          if (!current) return;
          const next = new Uint32Array(ids);
          rendererRef.current?.setCommunityIds(next);
          setCommunityData({ epoch: counts.epoch, ids: next });
        })
        .catch((error) => {
          if (current) console.error('Failed to calculate graph communities', error);
        });
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [counts, generation, graphSettingsLoaded, preferences.communityResolution, rendererRef, workspacePath]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!graphSettingsLoaded || !renderer || !counts || !workspacePath) return;
    renderer.setCustomGroupRules(preferences.groupRules.filter((rule) => rule.value.trim()
      && (rule.field !== 'property' || rule.key.trim())));
  }, [counts, generation, graphSettingsLoaded, preferences.groupRules, rendererRef, workspacePath]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!graphSettingsLoaded || !renderer || !counts || !workspacePath) return;
    if (groupRuleFilters.length === 0) {
      renderer.setCustomGroupIds(new Uint32Array(counts.nodeCount));
      return;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      void Promise.all(groupRuleFilters.map((rule) => loadGraphFilterNodes(workspacePath, counts.epoch, {
        folder: rule.field === 'folder' ? rule.value.trim() : '',
        tag: rule.field === 'tag' ? rule.value.trim() : '',
        propertyKey: rule.field === 'property' ? rule.key.trim() : '',
        propertyValue: rule.field === 'property' ? rule.value.trim() : '',
      }))).then((matches) => {
        if (!current) return;
        rendererRef.current?.setCustomGroupIds(customGroupIds(counts.nodeCount, matches));
      }).catch((error) => {
        if (current) console.error('Failed to apply graph color rules', error);
      });
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [counts, generation, graphSettingsLoaded, groupRuleFilters, rendererRef, workspacePath]);

  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !counts || !workspacePath) return;
    const filter = {
      folder: folderFilter.trim(),
      tag: tagFilter.trim(),
      propertyKey: propertyKeyFilter.trim(),
      propertyValue: propertyKeyFilter.trim() ? propertyValueFilter.trim() : '',
    };
    if (!filter.folder && !filter.tag && !filter.propertyKey && !filter.propertyValue) {
      renderer.setIncludedNodes(null);
      setFilterStatus('idle');
      return;
    }
    let current = true;
    setFilterStatus('loading');
    const timer = window.setTimeout(() => {
      void loadGraphFilterNodes(workspacePath, counts.epoch, filter)
        .then((nodes) => {
          if (!current) return;
          rendererRef.current?.setIncludedNodes(nodes);
          setFilterStatus('idle');
        })
        .catch((error) => {
          if (!current) return;
          console.error('Failed to apply graph metadata filters', error);
          setFilterStatus('error');
        });
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [
    counts,
    folderFilter,
    generation,
    propertyKeyFilter,
    propertyValueFilter,
    rendererRef,
    tagFilter,
    workspacePath,
  ]);

  const patchControls = useCallback((patch: Partial<GraphControls>) => {
    const {
      createdShare: nextShare,
      modifiedShare: nextModifiedShare,
      folderFilter: nextFolderFilter,
      tagFilter: nextTagFilter,
      propertyKeyFilter: nextPropertyKeyFilter,
      propertyValueFilter: nextPropertyValueFilter,
      ...rest
    } = patch;
    if (nextShare !== undefined) setCreatedShare(nextShare);
    if (nextModifiedShare !== undefined) setModifiedShare(nextModifiedShare);
    if (nextFolderFilter !== undefined) setFolderFilter(nextFolderFilter);
    if (nextTagFilter !== undefined) setTagFilter(nextTagFilter);
    if (nextPropertyKeyFilter !== undefined) {
      setPropertyKeyFilter(nextPropertyKeyFilter);
      if (!nextPropertyKeyFilter.trim()) setPropertyValueFilter('');
    }
    if (nextPropertyValueFilter !== undefined) setPropertyValueFilter(nextPropertyValueFilter);
    if (Object.keys(rest).length > 0) {
      setPreferences((current) => ({ ...current, ...rest }));
    }
  }, [setPreferences]);

  const savePreset = useCallback((name: string) => {
    const key = name.trim();
    if (!key) return;
    setPresets((current) => ({ ...current, [key]: controls }));
  }, [controls, setPresets]);

  const applyPreset = useCallback((name: string) => {
    const preset = presets[name];
    if (!preset) return;
    const {
      createdShare: presetCreatedShare,
      modifiedShare: presetModifiedShare,
      folderFilter: presetFolderFilter,
      tagFilter: presetTagFilter,
      propertyKeyFilter: presetPropertyKeyFilter,
      propertyValueFilter: presetPropertyValueFilter,
      ...presetPreferences
    } = preset;
    setPreferences({ ...DEFAULT_PREFERENCES, ...presetPreferences });
    const filterPatch: Partial<GraphControls> = {};
    if (presetCreatedShare !== undefined) filterPatch.createdShare = presetCreatedShare;
    if (presetModifiedShare !== undefined) filterPatch.modifiedShare = presetModifiedShare;
    if (presetFolderFilter !== undefined) filterPatch.folderFilter = presetFolderFilter;
    if (presetTagFilter !== undefined) filterPatch.tagFilter = presetTagFilter;
    if (presetPropertyKeyFilter !== undefined) filterPatch.propertyKeyFilter = presetPropertyKeyFilter;
    if (presetPropertyValueFilter !== undefined) filterPatch.propertyValueFilter = presetPropertyValueFilter;
    patchControls(filterPatch);
  }, [patchControls, presets, setPreferences]);

  const deletePreset = useCallback((name: string) => {
    setPresets((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, [setPresets]);

  return {
    controls,
    createdShare,
    filterStatus,
    setCreatedShare,
    patchControls,
    presets,
    savePreset,
    applyPreset,
    deletePreset,
    communityData,
  };
}
