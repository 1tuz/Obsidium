import { getLocale, plural, t } from '../../i18n';
import { memo, useState } from 'react';
import { PanelRightClose, PanelRightOpen, RotateCcw, Trash2 } from 'lucide';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { Slider } from '../Common/Slider';
import { Dropdown } from '../Common/Dropdown';
import { SegmentedControl } from '../Common/SegmentedControl';
import { Switch } from '../Common/Switch';
import { Button } from '../Common/Button';
import type { EdgeColor, EdgeStyle, GraphEdgeDirection, GraphEdgeType, GraphGroupRule, GraphLayoutMode, GraphPreferences, GraphPresets, HeatmapAxis } from './graphDisplay';
import { MIN_SPREAD } from './nodeMetrics';
import type { GraphDateRange, GraphPathState } from './renderer';
import { COMMUNITY_PAGE_SIZE, clampCommunityPage, type CommunityLabel } from './communitySummary';
import type { AnalysisResult } from '../../modules/analysis';
import { renameCommunity, setCommunityCollapsed } from './communityNames';
import { colorInputValue, readPalette, type Palette } from './palette';
import './GraphSettings.css';

export interface GraphControls extends GraphPreferences {
  createdShare: number;
  modifiedShare: number;
  folderFilter: string;
  tagFilter: string;
  propertyKeyFilter: string;
  propertyValueFilter: string;
}

function depthHints() {
  return [t('graph.depth1'), t('graph.depth2'), t('graph.depth3')];
}

function heatmapAxes() {
  return [
    { value: 'none', label: t('graph.heatNone') },
    { value: 'modified', label: t('graph.heatModified') },
    { value: 'created', label: t('graph.heatCreated') },
  ];
}

function edgeStyles() {
  return [
    { value: 'solid', label: t('graph.edgeSolid') },
    { value: 'dashed', label: t('graph.edgeDashed') },
  ];
}

function edgeColors() {
  return [
    { value: 'theme', label: t('graph.edgeTheme') },
    { value: 'nodes', label: t('graph.edgeNodes') },
    { value: 'heat', label: t('graph.edgeHeat') },
    { value: 'custom', label: t('graph.edgeCustom') },
  ];
}

function edgeTypes() {
  return [
    { value: 'all', label: t('graph.edgeTypeAll') },
    { value: 'wiki', label: t('graph.edgeTypeWiki') },
    { value: 'markdown', label: t('graph.edgeTypeMarkdown') },
    { value: 'parent', label: t('graph.edgeTypeParent') },
    { value: 'related', label: t('graph.edgeTypeRelated') },
    { value: 'depends_on', label: t('graph.edgeTypeDependsOn') },
    { value: 'blocks', label: t('graph.edgeTypeBlocks') },
  ];
}

function edgeDirections() {
  return [
    { value: 'all', label: t('graph.edgeDirectionAll') },
    { value: 'incoming', label: t('graph.edgeDirectionIncoming') },
    { value: 'outgoing', label: t('graph.edgeDirectionOutgoing') },
  ];
}

function groupFields() {
  return [
    { value: 'folder', label: t('graph.folderFilter') },
    { value: 'tag', label: t('graph.tagFilter') },
    { value: 'property', label: t('graph.propertyFilter') },
  ];
}

function groupColors() {
  return [
    { value: 'cold', label: t('graph.groupColorCold') },
    { value: 'hot', label: t('graph.groupColorHot') },
    { value: 'accent', label: t('graph.groupColorAccent') },
  ];
}

function layoutModes() {
  return [
    { value: 'force', label: t('graph.layoutForce') },
    { value: 'hierarchical', label: t('graph.layoutHierarchical') },
    { value: 'ring', label: t('graph.layoutRing') },
  ];
}

interface GraphSettingsProps {
  controls: GraphControls;
  range: GraphDateRange;
  onChange: (patch: Partial<GraphControls>) => void;
  onRefresh: () => void;
  presets: GraphPresets;
  onSavePreset: (name: string) => void;
  onApplyPreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
  pathMode: boolean;
  pathState: GraphPathState;
  onPathModeChange: (enabled: boolean) => void;
  onClearPath: () => void;
  filterStatus?: 'idle' | 'loading' | 'error';
  communities?: CommunityLabel[];
  communityCount?: number;
  communityPage?: number;
  onCommunityPageChange?: (page: number) => void;
  suggestions?: AnalysisResult[];
  suggestionsLoading?: boolean;
  onCreateSuggestedLink?: (suggestion: AnalysisResult) => void;
}

export const GraphSettings = memo(function GraphSettings({
  controls,
  range,
  onChange,
  onRefresh,
  presets,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
  pathMode,
  pathState,
  onPathModeChange,
  onClearPath,
  filterStatus = 'idle',
  communities = [],
  communityCount,
  communityPage = 0,
  onCommunityPageChange,
  suggestions = [],
  suggestionsLoading = false,
  onCreateSuggestedLink,
}: GraphSettingsProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [presetName, setPresetName] = useState('');
  const pickerPalette = controls.edgeColor === 'custom' || controls.groupRules.length > 0
    ? readPalette(document.documentElement)
    : null;
  const totalCommunities = communityCount ?? communities.length;
  const communityPageCount = Math.ceil(totalCommunities / COMMUNITY_PAGE_SIZE);
  const visibleCommunityPage = clampCommunityPage(communityPage, totalCommunities);
  const visibleCommunities = communityCount === undefined
    ? communities.slice(
      visibleCommunityPage * COMMUNITY_PAGE_SIZE,
      (visibleCommunityPage + 1) * COMMUNITY_PAGE_SIZE,
    )
    : communities;
  const threshold = range.oldest + (range.newest - range.oldest) * controls.createdShare;
  const modifiedThreshold = range.modifiedOldest
    + (range.modifiedNewest - range.modifiedOldest) * controls.modifiedShare;
  const pathStatusMessage = pathMessage(pathState);

  return (
    <aside
      className={`q-graph-settings${collapsed ? ' q-graph-settings--collapsed' : ''}`}
      aria-label={t('graph.settings')}
    >
      <div className="q-graph-settings-head">
        {!collapsed && <span className="q-graph-settings-title">{t('graph.title')}</span>}
        {!collapsed && (
          <IconButton label={t('graph.refresh')} size="small" onClick={onRefresh}>
            <Icon icon={RotateCcw} />
          </IconButton>
        )}
        <IconButton
          label={t(collapsed ? 'graph.expandSettings' : 'graph.collapseSettings')}
          size="small"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((current) => !current)}
        >
          <Icon icon={collapsed ? PanelRightOpen : PanelRightClose} />
        </IconButton>
      </div>

      {!collapsed && (
        <>
          <Dropdown
            ariaLabel={t('graph.layoutMode')}
            options={layoutModes()}
            value={controls.layoutMode}
            onChange={(layoutMode) => onChange({ layoutMode: layoutMode as GraphLayoutMode })}
          />

          {controls.layoutMode === 'force' && (
            <>
              <Slider
                label={t('graph.attraction')}
                min={0.5}
                max={2}
                step={0.1}
                value={controls.attraction}
                hint={`${controls.attraction.toFixed(1)}×`}
                onChange={(attraction) => onChange({ attraction })}
              />

              <Slider
                label={t('graph.repulsion')}
                min={0.5}
                max={2}
                step={0.1}
                value={controls.repulsion}
                hint={`${controls.repulsion.toFixed(1)}×`}
                onChange={(repulsion) => onChange({ repulsion })}
              />
            </>
          )}

          <Slider
            label={t('graph.nodeSize')}
            min={0.4}
            max={2.5}
            step={0.05}
            value={controls.nodeSize}
            hint={`${controls.nodeSize.toFixed(2)}×`}
            onChange={(nodeSize) => onChange({ nodeSize })}
          />

          <Slider
            label={t('graph.labelDensity')}
            min={0.25}
            max={1}
            step={0.05}
            value={controls.labelDensity}
            hint={`${Math.round(controls.labelDensity * 100)}%`}
            onChange={(labelDensity) => onChange({ labelDensity })}
          />

          <Slider
            label={t('graph.spread')}
            min={MIN_SPREAD}
            max={2.5}
            step={0.05}
            value={controls.spread}
            hint={`${controls.spread.toFixed(2)}×`}
            onChange={(spread) => onChange({ spread })}
          />

          <Slider
            label={t('graph.edgeWidth')}
            min={0.5}
            max={3}
            step={0.05}
            value={controls.edgeWidth}
            hint={`${controls.edgeWidth.toFixed(2)}×`}
            onChange={(edgeWidth) => onChange({ edgeWidth })}
          />

          <Slider
            label={t('graph.edgeOpacity')}
            min={0.1}
            max={1}
            step={0.05}
            value={controls.edgeOpacity}
            hint={`${Math.round(controls.edgeOpacity * 100)}%`}
            onChange={(edgeOpacity) => onChange({ edgeOpacity })}
          />

          <Slider
            label={t('graph.depth')}
            min={1}
            max={3}
            step={1}
            value={controls.highlightDepth}
            hint={depthHints()[controls.highlightDepth - 1]}
            onChange={(highlightDepth) => onChange({ highlightDepth })}
          />

          <div className="q-graph-settings-choice">
            <Slider
              label={t('graph.localDepth')}
              min={0}
              max={4}
              step={1}
              value={controls.localGraphDepth}
              hint={controls.localGraphDepth === 0 ? t('graph.globalGraph') : depthLabel(controls.localGraphDepth)}
              onChange={(localGraphDepth) => onChange({ localGraphDepth })}
            />
            <span>{t('graph.localGraphHelp')}</span>
          </div>

          <Slider
            label={t('graph.createdAfter')}
            min={0}
            max={1}
            step={0.005}
            value={controls.createdShare}
            hint={controls.createdShare === 0 ? t('graph.all') : formatDay(threshold)}
            onChange={(createdShare) => onChange({ createdShare })}
          />

          <Slider
            label={t('graph.modifiedAfter')}
            min={0}
            max={1}
            step={0.005}
            value={controls.modifiedShare}
            hint={controls.modifiedShare === 0 ? t('graph.all') : formatDay(modifiedThreshold)}
            onChange={(modifiedShare) => onChange({ modifiedShare })}
          />

          <Slider
            label={t('graph.createdBefore')}
            min={0}
            max={1}
            step={0.005}
            value={controls.createdBeforeShare}
            hint={controls.createdBeforeShare === 1 ? t('graph.all') : formatDay(
              range.oldest + (range.newest - range.oldest) * controls.createdBeforeShare,
            )}
            onChange={(createdBeforeShare) => onChange({ createdBeforeShare })}
          />

          <Slider
            label={t('graph.modifiedBefore')}
            min={0}
            max={1}
            step={0.005}
            value={controls.modifiedBeforeShare}
            hint={controls.modifiedBeforeShare === 1 ? t('graph.all') : formatDay(
              range.modifiedOldest + (range.modifiedNewest - range.modifiedOldest) * controls.modifiedBeforeShare,
            )}
            onChange={(modifiedBeforeShare) => onChange({ modifiedBeforeShare })}
          />

          <fieldset className="q-graph-settings-filters">
            <legend>{t('graph.metadataFilters')}</legend>
            <label>
              <span>{t('graph.folderFilter')}</span>
              <input
                value={controls.folderFilter}
                onChange={(event) => onChange({ folderFilter: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>{t('graph.tagFilter')}</span>
              <input
                value={controls.tagFilter}
                onChange={(event) => onChange({ tagFilter: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>{t('graph.propertyFilter')}</span>
              <input
                value={controls.propertyKeyFilter}
                onChange={(event) => onChange({ propertyKeyFilter: event.currentTarget.value })}
              />
            </label>
            <label>
              <span>{t('graph.propertyValueFilter')}</span>
              <input
                value={controls.propertyValueFilter}
                onChange={(event) => onChange({ propertyValueFilter: event.currentTarget.value })}
                disabled={!controls.propertyKeyFilter.trim()}
              />
            </label>
            {filterStatus !== 'idle' && (
              <span role={filterStatus === 'error' ? 'alert' : 'status'}>
                {t(filterStatus === 'loading' ? 'graph.filterLoading' : 'graph.filterError')}
              </span>
            )}
          </fieldset>

          <div className="q-graph-settings-path">
            <Button
              size="s"
              variant={pathMode ? 'primary' : 'ghost'}
              aria-pressed={pathMode}
              onClick={() => onPathModeChange(!pathMode)}
            >
              {t(pathMode ? 'graph.cancelPath' : 'graph.findPath')}
            </Button>
            {pathStatusMessage && <span>{pathStatusMessage}</span>}
            {pathState.status !== 'idle' && (
              <Button size="s" variant="ghost" onClick={onClearPath}>
                {t('graph.clearPath')}
              </Button>
            )}
          </div>

          <label className="q-graph-settings-toggle">
            <span>{t('graph.suggestedLinks')}</span>
            <Switch
              checked={controls.suggestionsEnabled}
              onChange={(suggestionsEnabled) => onChange({ suggestionsEnabled })}
            />
          </label>
          {controls.suggestionsEnabled && (
            <div className="q-graph-settings-suggestions">
              <Dropdown
                ariaLabel={t('graph.suggestionMethod')}
                options={[
                  { value: 'adamicAdar', label: 'Adamic-Adar' },
                  { value: 'bm25f', label: t('analysis.methods.bm25f') },
                ]}
                value={controls.suggestionMethod}
                onChange={(suggestionMethod) => onChange({
                  suggestionMethod: suggestionMethod as GraphControls['suggestionMethod'],
                })}
              />
              {suggestionsLoading && <span role="status">{t('graph.suggestionsLoading')}</span>}
              {!suggestionsLoading && suggestions.length === 0 && (
                <span>{t('graph.suggestionsEmpty')}</span>
              )}
              {suggestions.map((suggestion) => (
                <div className="q-graph-settings-suggestion" key={suggestion.path}>
                  <span title={suggestion.reasons.join(', ')}>{suggestion.title}</span>
                  <Button size="xs" variant="ghost" onClick={() => onCreateSuggestedLink?.(suggestion)}>
                    {t('graph.createSuggestedLink')}
                  </Button>
                </div>
              ))}
            </div>
          )}

          <label className="q-graph-settings-toggle">
            <span>{t('graph.labels')}</span>
            <Switch
              checked={controls.labels}
              onChange={(labels) => onChange({ labels })}
            />
          </label>

          <label className="q-graph-settings-toggle">
            <span>{t('graph.orphans')}</span>
            <Switch
              checked={controls.orphanHighlight}
              onChange={(orphanHighlight) => onChange({ orphanHighlight })}
            />
          </label>

          <label className="q-graph-settings-toggle">
            <span>{t('graph.islands')}</span>
            <Switch
              checked={controls.islandHighlight}
              onChange={(islandHighlight) => onChange({ islandHighlight })}
            />
          </label>

          <label className="q-graph-settings-toggle">
            <span>{t('graph.importantNodes')}</span>
            <Switch
              checked={controls.importantNodes}
              onChange={(importantNodes) => onChange({ importantNodes })}
            />
          </label>

          <label className="q-graph-settings-toggle">
            <span>{t('graph.communityColors')}</span>
            <Switch
              checked={controls.communityColors}
              onChange={(communityColors) => onChange({ communityColors })}
            />
          </label>

          <label className="q-graph-settings-toggle">
            <span>{t('graph.customGroupColors')}</span>
            <Switch
              checked={controls.customGroupColors}
              onChange={(customGroupColors) => onChange({ customGroupColors })}
            />
          </label>

          <fieldset className="q-graph-settings-groups">
            <legend>{t('graph.customGroups')}</legend>
            {controls.groupRules.map((rule) => (
              <div key={rule.id}>
                <Dropdown
                  ariaLabel={t('graph.groupField')}
                  options={groupFields()}
                  value={rule.field}
                  onChange={(field) => updateGroupRule(controls, onChange, rule.id, {
                    field: field as GraphGroupRule['field'],
                  })}
                />
                {rule.field === 'property' && (
                  <input
                    aria-label={t('graph.propertyFilter')}
                    placeholder={t('graph.propertyFilter')}
                    value={rule.key}
                    onChange={(event) => updateGroupRule(controls, onChange, rule.id, { key: event.currentTarget.value })}
                  />
                )}
                <input
                  aria-label={t('graph.groupValue')}
                  placeholder={t('graph.groupValue')}
                  value={rule.value}
                  onChange={(event) => updateGroupRule(controls, onChange, rule.id, { value: event.currentTarget.value })}
                />
                <Dropdown
                  ariaLabel={t('graph.groupColor')}
                  options={groupColors()}
                  value={rule.color}
                  onChange={(color) => updateGroupRule(controls, onChange, rule.id, {
                    color: color as GraphGroupRule['color'],
                  })}
                />
                <label className="q-graph-settings-color">
                  <span>{t('graph.groupCustomColor')}</span>
                  <input
                    type="color"
                    aria-label={t('graph.groupCustomColor')}
                    value={rule.customColor ?? colorInputValue(groupPaletteColor(rule.color, pickerPalette!))}
                    onChange={(event) => updateGroupRule(controls, onChange, rule.id, {
                      customColor: event.currentTarget.value,
                    })}
                  />
                </label>
                {rule.customColor && (
                  <Button size="xs" variant="ghost" onClick={() => updateGroupRule(
                    controls,
                    onChange,
                    rule.id,
                    { customColor: null },
                  )}>
                    {t('graph.groupUseThemeColor')}
                  </Button>
                )}
                <Button size="xs" variant="ghost" onClick={() => onChange({
                  groupRules: controls.groupRules.filter(({ id }) => id !== rule.id),
                })}>
                  {t('graph.removeGroup')}
                </Button>
              </div>
            ))}
            <Button size="s" variant="ghost" onClick={() => onChange({
              groupRules: [...controls.groupRules, {
                id: crypto.randomUUID(), field: 'folder', key: '', value: '', color: 'cold',
              }],
            })}>
              {t('graph.addGroup')}
            </Button>
          </fieldset>

          <Slider
            label={t('graph.communityResolution')}
            min={0.5}
            max={2.5}
            step={0.1}
            value={controls.communityResolution}
            hint={`γ ${controls.communityResolution.toFixed(1)}`}
            onChange={(communityResolution) => onChange({ communityResolution })}
          />

          {totalCommunities > 0 && (
            <fieldset className="q-graph-settings-communities">
              <legend>{t('graph.communities')}</legend>
              {visibleCommunities.map((community) => (
                <div className="q-graph-settings-community" key={community.id}>
                  <label>
                    <span>{plural('graph.notes', community.count)}</span>
                    <input
                      aria-label={t('graph.renameCommunity', { name: community.name })}
                      maxLength={60}
                      value={community.name}
                      onChange={(event) => onChange({
                        communityNames: renameCommunity(
                          controls.communityNames,
                          community.stableId,
                          event.currentTarget.value,
                        ),
                      })}
                    />
                  </label>
                  <Switch
                    checked={controls.collapsedCommunities[community.stableId] === true}
                    label={t('graph.collapseCommunity', { name: community.name })}
                    onChange={(value) => onChange({
                      collapsedCommunities: setCommunityCollapsed(
                        controls.collapsedCommunities,
                        community.stableId,
                        value,
                      ),
                    })}
                  />
                </div>
              ))}
              {communityPageCount > 1 && (
                <div className="q-graph-settings-community-pages">
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={t('graph.communityPrevious')}
                    disabled={visibleCommunityPage === 0}
                    onClick={() => onCommunityPageChange?.(visibleCommunityPage - 1)}
                  >
                    {t('graph.communityPrevious')}
                  </Button>
                  <span>
                    {t('graph.communityPageRange', {
                      from: visibleCommunityPage * COMMUNITY_PAGE_SIZE + 1,
                      to: Math.min((visibleCommunityPage + 1) * COMMUNITY_PAGE_SIZE, totalCommunities),
                      total: totalCommunities,
                    })}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label={t('graph.communityNext')}
                    disabled={visibleCommunityPage + 1 >= communityPageCount}
                    onClick={() => onCommunityPageChange?.(visibleCommunityPage + 1)}
                  >
                    {t('graph.communityNext')}
                  </Button>
                </div>
              )}
            </fieldset>
          )}

          <label className="q-graph-settings-toggle">
            <span>{t('graph.arrows')}</span>
            <Switch
              checked={controls.arrows}
              onChange={(arrows) => onChange({ arrows })}
            />
          </label>

          <div className="q-graph-settings-choice">
            <span>{t('graph.heatmap')}</span>
            <SegmentedControl
              stretch
              options={heatmapAxes()}
              value={controls.heatmapAxis}
              onChange={(value) => onChange({ heatmapAxis: value as HeatmapAxis })}
            />
          </div>

          <div className="q-graph-settings-choice">
            <span>{t('graph.edgeStyle')}</span>
            <SegmentedControl
              stretch
              options={edgeStyles()}
              value={controls.edgeStyle}
              onChange={(value) => onChange({ edgeStyle: value as EdgeStyle })}
            />
          </div>

          <div className="q-graph-settings-choice">
            <span>{t('graph.edgeType')}</span>
            <Dropdown
              ariaLabel={t('graph.edgeType')}
              options={edgeTypes()}
              value={controls.edgeType}
              onChange={(value) => onChange({ edgeType: value as GraphEdgeType })}
            />
          </div>

          <div className="q-graph-settings-choice">
            <span>{t('graph.edgeDirection')}</span>
            <Dropdown
              ariaLabel={t('graph.edgeDirection')}
              options={edgeDirections()}
              value={controls.edgeDirection}
              onChange={(value) => onChange({ edgeDirection: value as GraphEdgeDirection })}
            />
            {controls.edgeDirection !== 'all' && (
              <span>{t('graph.edgeDirectionHint')}</span>
            )}
          </div>

          <div className="q-graph-settings-choice">
            <span>{t('graph.edgeColor')}</span>
            <SegmentedControl
              stretch
              options={edgeColors()}
              value={controls.edgeColor}
              onChange={(value) => onChange({ edgeColor: value as EdgeColor })}
            />
            {controls.edgeColor === 'custom' && (
              <label className="q-graph-settings-color">
                <span>{t('graph.edgeCustomColor')}</span>
                <input
                  type="color"
                  aria-label={t('graph.edgeCustomColor')}
                  value={controls.edgeCustomColor ?? colorInputValue(pickerPalette!.edge)}
                  onChange={(event) => onChange({ edgeCustomColor: event.currentTarget.value })}
                />
              </label>
            )}
          </div>

          <div className="q-graph-settings-presets">
            <form
              className="q-graph-settings-preset-form"
              onSubmit={(event) => {
                event.preventDefault();
                onSavePreset(presetName);
                setPresetName('');
              }}
            >
              <label htmlFor="q-graph-preset-name">{t('graph.presetName')}</label>
              <input
                id="q-graph-preset-name"
                value={presetName}
                onChange={(event) => setPresetName(event.currentTarget.value)}
                maxLength={40}
              />
              <button type="submit" disabled={!presetName.trim()}>{t('graph.savePreset')}</button>
            </form>
            {Object.keys(presets).sort().map((name) => (
              <div className="q-graph-settings-preset" key={name}>
                <button type="button" onClick={() => onApplyPreset(name)}>{name}</button>
                <IconButton
                  label={t('graph.deletePreset', { name })}
                  size="small"
                  onClick={() => onDeletePreset(name)}
                >
                  <Icon icon={Trash2} />
                </IconButton>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
});

function updateGroupRule(
  controls: GraphControls,
  onChange: GraphSettingsProps['onChange'],
  id: string,
  patch: Partial<GraphGroupRule>,
) {
  onChange({
    groupRules: controls.groupRules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule),
  });
}

function groupPaletteColor(color: GraphGroupRule['color'], palette: Palette): Palette['cold'] {
  if (color === 'cold') return palette.cold;
  if (color === 'hot') return palette.hot;
  return palette.edgeActive;
}

function pathMessage(state: GraphPathState): string | null {
  switch (state.status) {
    case 'idle': return null;
    case 'selectStart': return t('graph.pathSelectStart');
    case 'selectEnd': return t('graph.pathSelectEnd');
    case 'found': return t('graph.pathFound', { count: state.nodeCount });
    case 'missing': return t('graph.pathMissing');
  }
}

function formatDay(day: number): string {
  if (!Number.isFinite(day) || day <= 0) return t('graph.all');
  return new Date(day * 86_400_000).toLocaleDateString(getLocale(), {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function depthLabel(depth: number): string {
  return t('graph.localDepthValue', { depth });
}
