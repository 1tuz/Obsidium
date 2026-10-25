import { createContext, useContext, useState, ReactNode, useCallback, useMemo, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { setTheme } from '../theme';
import { setIconSet, type IconSet } from '../iconSet';
import { normalizeReadingTheme, type ReadingThemeId } from '../theme/reading';
import { setLanguage } from '../../i18n';
import { setFilesFolder } from '../docs/vaultFiles';
import { pxToRem } from '../scaling';
import { fontStack, IA_WRITER_QUATTRO, knownFont, type FontFamily } from '../../fonts/catalog';
import type { GraphPreferences, GraphPresets } from '../../components/Graph/graphDisplay';

export interface FontSettings {
  fontFamily: FontFamily;
  fontWeight: number;
  fontSizeBase: number;
}

interface Bm25fParams {
  k1: number;
  k3: number;
  bTitle: number;
  bBody: number;
  titleWeight: number;
}

interface AnalysisSettings {
  enableBm25f: boolean;
  enableAdamicAdar: boolean;
  enableDuplicates: boolean;
  enableUnlinkedMentions: boolean;
  enableWikixiv: boolean;
  bm25fParams: Bm25fParams;
}

interface SearchIndexSettings {
  candidatePoolSize: number;
  maxQueryTerms: number;
  synonymGroups: string[][];
}

interface EditorSettings extends FontSettings {
  saveDebounceMs: number;
  lineHeight: number;
  maxWidthCh: number;
  fullWidth: boolean;
  markdownReading: MarkdownReadingSettings;
  smartDashes: boolean;
  listCallouts: boolean;
  autoLinkTitle: boolean;
  linkSuggest: boolean;
  linkSuggestMinChars: number;
  liveTabs: number;
}

export type MarkdownReadingStyle = 'theme' | 'paper-white' | 'ivory' | 'parchment' | 'sepia' | 'dark-paper';
export type MarkdownReadingTexture = 'off' | 'subtle' | 'visible';
export type MarkdownReadingFont = 'standard' | 'book';

export interface MarkdownReadingSettings {
  style: MarkdownReadingStyle;
  texture: MarkdownReadingTexture;
  font: MarkdownReadingFont;
  fontSizePx: number;
  lineHeight: number;
  pageWidthCh: number;
}

export const DEFAULT_MARKDOWN_READING_SETTINGS: MarkdownReadingSettings = {
  style: 'theme',
  texture: 'off',
  font: 'standard',
  fontSizePx: 18,
  lineHeight: 1.7,
  pageWidthCh: 100,
};

export const DEFAULT_EDITOR_MAX_WIDTH_CH = 100;
export const DEFAULT_LIVE_TABS = 3;

export const DEFAULT_LINK_SUGGEST_MIN_CHARS = 2;

export type ReaderFlow = 'paginated' | 'scrolled';

export interface ReaderSettings extends FontSettings {
  lineHeight: number;
  maxWidthCh: number;
  marginPx: number;
  justify: boolean;
  hyphenate: boolean;
  flow: ReaderFlow;
  paperTheme?: ReadingThemeId;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontFamily: IA_WRITER_QUATTRO,
  fontWeight: 400,
  fontSizeBase: 18,
  lineHeight: 1.6,
  maxWidthCh: 65,
  marginPx: 48,
  justify: true,
  hyphenate: true,
  flow: 'paginated',
  paperTheme: 'inherit',
};

interface UiSettings extends FontSettings {
  appearance: 'system' | 'light' | 'dark';
  iconSet: 'lucide' | 'tabler' | 'phosphor';
  palette: string;
  accentMode: 'palette' | 'custom';
  motion: 'system' | 'on' | 'off';
  enabledSnippets: Record<string, string[]>;
  language: string;
  primaryColor: string;
}

export interface McpSettings {
  enabled: boolean;
  port: number;
  token: string;
  allowWrite: boolean;
}

interface TrashSettings {
  retentionDays: number;
}

interface HistorySettings {
  retentionDays: number;
}

export interface BuiltinPluginSettings {
  editingToolbar: boolean;
  kanban: boolean;
  panes: boolean;
  toolbarPosition: 'top' | 'selection';
  highlightr: boolean;
  outliner: boolean;
  iconize: boolean;
  highlightColors: string[];
  iconAssignments: Record<string, Record<string, FileIconAssignment>>;
}

export type FileIconId = 'file' | 'folder' | 'book' | 'star' | 'tag' | 'code' | 'briefcase' | 'pin' | 'heart' | 'music';
export interface FileIconAssignment { name: FileIconId; color: string }

export const DEFAULT_BUILTINS: BuiltinPluginSettings = {
  editingToolbar: true,
  kanban: true,
  panes: true,
  toolbarPosition: 'top',
  highlightr: true,
  outliner: true,
  iconize: true,
  highlightColors: ['#ffe96b', '#b8f3c3', '#a6dfff', '#ffc6df', '#dcc9ff', '#ffcf9c'],
  iconAssignments: {},
};

export interface JournalSettings {
  folder: string;
  dateFormat: string;
  templatePath: string | null;
}

export interface AppConfig {
  builtins?: BuiltinPluginSettings;
  analysis: AnalysisSettings;
  mcp: McpSettings;
  trash: TrashSettings;
  history: HistorySettings;
  search: SearchIndexSettings;
  editor: EditorSettings;
  reader: ReaderSettings;
  ui: UiSettings;
  journal: JournalSettings;
  templates: { folder: string };
  files: { folder: string };
  updates: { auto: boolean };
  graph?: {
    preferences: GraphPreferences | null;
    presets: GraphPresets | null;
  };
}

interface SettingsContextValue {
  config: AppConfig | null;
  isLoading: boolean;
  loadConfig: () => Promise<AppConfig | null>;
  updateConfig: (newConfig: AppConfig) => Promise<void>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function applyFont(root: HTMLElement, font: FontSettings, scope: 'ui' | 'editor') {
  const stack = fontStack(font.fontFamily);
  const weight = String(font.fontWeight);
  if (scope === 'ui') {
    root.style.setProperty('--q-font-family-ui', stack);
    root.style.setProperty('--q-font-weight-ui-base', weight);
    const size = font.fontSizeBase;
    root.style.setProperty('--q-font-size-ui-base', pxToRem(size));
    root.style.setProperty('--q-font-size-ui-sm', pxToRem(Math.round(size * (12 / 14))));
    root.style.setProperty('--q-font-size-ui-lg', pxToRem(Math.round(size * (16 / 14))));
    root.style.setProperty('--q-font-size-ui-xs', pxToRem(Math.round(size * (10 / 14))));
    return;
  }

  root.style.setProperty('--q-font-family-editor', stack);
  root.style.setProperty('--q-editor-font-weight', weight);
  root.style.setProperty('--q-editor-font-size', pxToRem(font.fontSizeBase));
}

const LEGACY_EDITOR_MAX_WIDTH_CH = 65;

function widenLegacyWidth(value: number | undefined, fallback: number): number {
  return value === undefined || value === LEGACY_EDITOR_MAX_WIDTH_CH ? fallback : value;
}

export function normalizeConfig(config: AppConfig): AppConfig {
  const iconSet = config.ui.iconSet as IconSet | undefined;
  return {
    ...config,
    builtins: { ...DEFAULT_BUILTINS, ...config.builtins },
    ui: {
      ...knownFont('ui', config.ui),
      iconSet: iconSet === 'tabler' || iconSet === 'phosphor' ? iconSet : 'lucide',
    },
    editor: {
      ...knownFont('editor', config.editor),
      maxWidthCh: widenLegacyWidth(config.editor.maxWidthCh, DEFAULT_EDITOR_MAX_WIDTH_CH),
      fullWidth: config.editor.fullWidth === true,
      markdownReading: {
        ...DEFAULT_MARKDOWN_READING_SETTINGS,
        ...config.editor.markdownReading,
        pageWidthCh: widenLegacyWidth(config.editor.markdownReading?.pageWidthCh, DEFAULT_MARKDOWN_READING_SETTINGS.pageWidthCh),
      },
    },
    reader: { ...knownFont('reader', config.reader), paperTheme: normalizeReadingTheme(config.reader.paperTheme) },
  };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const saveQueue = useRef(Promise.resolve());
  const loadPromise = useRef<Promise<AppConfig | null> | null>(null);

  const loadConfig = useCallback(() => {
    if (loadPromise.current) return loadPromise.current;
    setIsLoading(true);
    const pending = invoke<AppConfig>('get_settings')
      .then((loadedConfig) => {
        const newConfig = normalizeConfig(loadedConfig);
        applySettingsToDom(newConfig);
        setConfig(newConfig);
        return newConfig;
      })
      .catch((err) => {
        console.error('Failed to load settings:', err);
        return null;
      })
      .finally(() => {
        setIsLoading(false);
        loadPromise.current = null;
      });
    loadPromise.current = pending;
    return pending;
  }, []);

  const updateConfig = useCallback(async (newConfig: AppConfig) => {
    applySettingsToDom(newConfig);
    setConfig(newConfig);
    const save = saveQueue.current
      .catch(() => undefined)
      .then(() => invoke('update_settings', { newConfig }))
      .then(() => undefined);
    saveQueue.current = save;
    await save;
  }, []);

  const value = useMemo(() => ({
    config, isLoading, loadConfig, updateConfig,
  }), [config, isLoading, loadConfig, updateConfig]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsStore() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettingsStore must be used within SettingsProvider');
  }
  return context;
}

function applySettingsToDom(config: AppConfig) {
  const root = document.documentElement;
  void setIconSet(config.ui.iconSet).catch((error) => console.error('Failed to load icon set:', error));
  setLanguage(config.ui.language);
  setFilesFolder(config.files.folder);
  setTheme(
    config.ui.appearance,
    config.ui.palette,
    config.ui.motion,
    config.ui.accentMode,
    config.ui.primaryColor,
  );
  applyFont(root, config.ui, 'ui');
  applyFont(root, config.editor, 'editor');
  root.style.setProperty('--q-editor-line-height', String(config.editor.lineHeight));
  root.style.setProperty(
    '--q-editor-max-width',
    config.editor.fullWidth ? 'none' : `${config.editor.maxWidthCh}ch`,
  );
}
