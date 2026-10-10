export type HeatmapAxis = 'none' | 'modified' | 'created';
export type EdgeStyle = 'solid' | 'dashed';
export type EdgeColor = 'theme' | 'nodes' | 'heat' | 'custom';
export type GraphEdgeType = 'all' | 'wiki' | 'markdown' | 'parent' | 'related' | 'depends_on' | 'blocks';
export type GraphEdgeDirection = 'all' | 'incoming' | 'outgoing';
export type GraphSuggestionMethod = 'adamicAdar' | 'bm25f';
export type GraphLayoutMode = 'force' | 'hierarchical' | 'ring';
export type GraphGroupColor = 'cold' | 'hot' | 'accent';

export interface GraphGroupRule {
  id: string;
  field: 'folder' | 'tag' | 'property';
  key: string;
  value: string;
  color: GraphGroupColor;
  customColor?: string | null;
}

export interface GraphPreferences {
  layoutMode: GraphLayoutMode;
  attraction: number;
  repulsion: number;
  createdBeforeShare: number;
  modifiedBeforeShare: number;
  nodeSize: number;
  spread: number;
  highlightDepth: number;
  localGraphDepth: number;
  labelDensity: number;
  labels: boolean;
  orphanHighlight: boolean;
  islandHighlight: boolean;
  importantNodes: boolean;
  communityColors: boolean;
  customGroupColors: boolean;
  groupRules: GraphGroupRule[];
  communityResolution: number;
  communityNames: Record<string, string>;
  collapsedCommunities: Record<string, boolean>;
  heatmapAxis: HeatmapAxis;
  edgeWidth: number;
  edgeOpacity: number;
  edgeStyle: EdgeStyle;
  edgeColor: EdgeColor;
  edgeCustomColor: string | null;
  arrows: boolean;
  suggestionsEnabled: boolean;
  suggestionMethod: GraphSuggestionMethod;
  edgeType: GraphEdgeType;
  edgeDirection: GraphEdgeDirection;
}

export interface GraphPreset extends GraphPreferences {
  createdShare?: number;
  modifiedShare?: number;
  folderFilter?: string;
  tagFilter?: string;
  propertyKeyFilter?: string;
  propertyValueFilter?: string;
}

export type GraphPresets = Record<string, GraphPreset>;

export const DEFAULT_PREFERENCES: GraphPreferences = {
  layoutMode: 'force',
  attraction: 1,
  repulsion: 1,
  createdBeforeShare: 1,
  modifiedBeforeShare: 1,
  nodeSize: 1,
  spread: 1,
  highlightDepth: 1,
  localGraphDepth: 0,
  labelDensity: 1,
  labels: true,
  orphanHighlight: false,
  islandHighlight: false,
  importantNodes: false,
  communityColors: false,
  customGroupColors: true,
  groupRules: [],
  communityResolution: 1,
  communityNames: {},
  collapsedCommunities: {},
  heatmapAxis: 'none',
  edgeWidth: 1,
  edgeOpacity: 0.65,
  edgeStyle: 'solid',
  edgeColor: 'theme',
  edgeCustomColor: null,
  arrows: false,
  suggestionsEnabled: false,
  suggestionMethod: 'adamicAdar',
  edgeType: 'all',
  edgeDirection: 'all',
};

export interface GraphDisplay extends GraphPreferences {
  createdFrom: number;
  createdTo: number;
  modifiedFrom: number;
  modifiedTo: number;
}

export const DEFAULT_DISPLAY: GraphDisplay = {
  ...DEFAULT_PREFERENCES,
  createdFrom: Number.NEGATIVE_INFINITY,
  createdTo: Number.POSITIVE_INFINITY,
  modifiedFrom: Number.NEGATIVE_INFINITY,
  modifiedTo: Number.POSITIVE_INFINITY,
};
