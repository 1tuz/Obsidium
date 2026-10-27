import { memo, useEffect, useRef, type MouseEvent } from 'react';
import { t } from '../../i18n';
import {
  enabledSidebarMethods,
  isGraphAnalysisMethod,
  useDocumentAnalysis,
  type AnalysisResult,
  type SidebarSourceMethod,
} from '../../modules/analysis';
import {
  useDocumentLinks,
  type Backlink,
  type LinkDisposition,
  type LinkMode,
  type OutgoingLink,
} from '../../modules/links';
import { isMarkdownPath } from '../../modules/documents/fileGateway';
import { openExternalUrl } from '../../modules/openExternalUrl';
import { fileStem } from '../../modules/paths';
import { useSettingsStore } from '../../modules/settings';
import { useWikixivSources, setWikiHover, clearWikiHover } from '../../modules/wikixiv';
import { isEmptyTabPath } from '../../modules/ui-state';
import { useLocalState } from '../../modules/workspace/uiPersist';
import { Chip } from '../Common/Chip';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import type { IconId } from '../Common/iconCatalog';
import { useHorizontalWheelScroll } from '../Common/useHorizontalWheelScroll';
import { ActivityHeatmap } from '../Stats/ActivityHeatmap';
import { HistoryList } from '../History/HistoryList';
import { InsightsPanel } from '../Analysis/InsightsPanel';
import { SidebarDocumentItem } from './SidebarDocumentItem';
import { LocalGraph } from './LocalGraph';
import './BacklinksPanel.css';

const PANEL_MODES = ['vault', 'backlinks', 'outgoing', 'localGraph', 'analysis', 'history'] as const;

type PanelMode = typeof PANEL_MODES[number];

interface ModeTab {
  mode: PanelMode;
  icon: IconId;
  label: string;
}

const MODE_TABS: readonly ModeTab[] = [
  { mode: 'vault', icon: 'analytics', label: 'backlinks.vaultTab' },
  { mode: 'backlinks', icon: 'link2', label: 'backlinks.backlinksTab' },
  { mode: 'outgoing', icon: 'arrow-up-right', label: 'backlinks.outgoingTab' },
  { mode: 'localGraph', icon: 'graph', label: 'localGraph.tab' },
  { mode: 'analysis', icon: 'search', label: 'analysis.tab' },
  { mode: 'history', icon: 'history', label: 'backlinks.historyTab' },
];

const MODE_STORAGE_KEY = 'obsidium_backlinks_mode';
const METHOD_STORAGE_KEY = 'obsidium_analysis_method';
const DEFAULT_MODE: PanelMode = 'vault';

function isPanelMode(value: string): value is PanelMode {
  return (PANEL_MODES as readonly string[]).includes(value);
}

function resolvePanelMode(stored: string, sourcesAvailable: boolean): PanelMode {
  if (!isPanelMode(stored)) return DEFAULT_MODE;
  if (stored === 'analysis' && !sourcesAvailable) return DEFAULT_MODE;
  return stored;
}

interface BacklinksPanelProps {
  workspacePath: string | null;
  documentPath: string | null;
  activeTabId: string | null;
  indexReady: boolean;
  indexRevision: number;
  isOpen: boolean;
  historyRequest?: number;
  onOpenBacklink: (backlink: Backlink, disposition: LinkDisposition) => void;
  onOpenOutgoing: (link: OutgoingLink, disposition: LinkDisposition) => void;
  onOpenAnalysis: (result: AnalysisResult, disposition: LinkDisposition) => void;
  onOpenLocalGraph: (path: string, disposition: LinkDisposition) => void;
  onOpenNote?: (path: string) => void;
}

function dispositionFromEvent(event: MouseEvent<Element>): LinkDisposition {
  return event.ctrlKey || event.metaKey ? 'new-tab' : 'current';
}

function sourceMethodLabel(method: SidebarSourceMethod): string {
  return t(`analysis.methods.${method}`);
}

function analysisCounter(result: AnalysisResult, method: SidebarSourceMethod): string {
  if (method === 'unlinkedMentions') return String(Math.round(result.rawScore));
  if (result.confidence !== undefined) return `${(result.confidence * 100).toFixed(1)}%`;
  return result.rawScore.toFixed(2);
}

function PanelStatus({ state, text }: { state: 'loading' | 'waiting'; text: string }) {
  return (
    <p className="q-backlinks__status" role="status" aria-busy="true" data-state={state}>
      {state === 'loading' && <Icon icon="loader-circle" size={14} className="q-backlinks__spinner" />}
      <span className="q-backlinks__status-text">{text}</span>
    </p>
  );
}

function BacklinksPanelComponent({
  workspacePath,
  documentPath,
  activeTabId,
  indexReady,
  indexRevision,
  isOpen,
  historyRequest = 0,
  onOpenBacklink,
  onOpenOutgoing,
  onOpenAnalysis,
  onOpenLocalGraph,
  onOpenNote,
}: BacklinksPanelProps) {
  const { config } = useSettingsStore();
  const sidebarMethods = enabledSidebarMethods(config?.analysis);
  const sourcesAvailable = sidebarMethods.length > 0;
  const [storedMode, setMode] = useLocalState<string>(MODE_STORAGE_KEY, DEFAULT_MODE);
  const mode = resolvePanelMode(storedMode, sourcesAvailable);
  const [sourceMethod, setSourceMethod] = useLocalState<SidebarSourceMethod>(
    METHOD_STORAGE_KEY,
    'bm25f',
  );
  const activeSourceMethod = sidebarMethods.includes(sourceMethod)
    ? sourceMethod
    : sidebarMethods[0] ?? sourceMethod;
  const chipRowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (historyRequest > 0) setMode('history');
  }, [historyRequest, setMode]);

  useEffect(() => {
    if (!isPanelMode(storedMode)) setMode(DEFAULT_MODE);
  }, [setMode, storedMode]);

  const hasDocument = Boolean(
    workspacePath && documentPath && !isEmptyTabPath(documentPath) && isMarkdownPath(documentPath),
  );
  const isVault = mode === 'vault';
  const isAnalysis = mode === 'analysis';
  const isHistory = mode === 'history';
  const isLocalGraph = mode === 'localGraph';
  const isLinks = mode === 'backlinks' || mode === 'outgoing';
  const isWixiv = isAnalysis && activeSourceMethod === 'wixiv';
  useHorizontalWheelScroll(chipRowRef, isAnalysis, sidebarMethods.length);

  useEffect(() => {
    if (!isAnalysis) clearWikiHover();
    return clearWikiHover;
  }, [isAnalysis]);

  const isGraphAnalysis = isAnalysis && isGraphAnalysisMethod(activeSourceMethod);
  const linkMode: LinkMode = mode === 'outgoing' ? 'outgoing' : 'backlinks';
  const { result: linkResult, loading: linksLoading } = useDocumentLinks(
    linkMode,
    workspacePath,
    documentPath,
    indexReady,
    indexRevision,
    isOpen && hasDocument && isLinks,
  );
  const {
    items: analysisItems,
    failed: analysisFailed,
    loading: analysisLoading,
  } = useDocumentAnalysis(
    isGraphAnalysis ? activeSourceMethod : 'bm25f',
    workspacePath,
    documentPath,
    indexReady,
    indexRevision,
    isOpen && hasDocument && isGraphAnalysis,
  );
  const {
    hits: wikixivHits,
    offline: wikixivOffline,
    insufficientText: wikixivInsufficient,
    failed: wikixivFailed,
    loading: wikixivLoading,
  } = useWikixivSources(documentPath, isOpen && hasDocument && isWixiv);

  const openNote = (path: string) => {
    if (onOpenNote) onOpenNote(path);
    else onOpenLocalGraph(path, 'current');
  };
  const noteName = hasDocument && documentPath ? fileStem(documentPath) : null;
  const scope = isVault
    ? t('backlinks.vaultTitle')
    : isHistory && noteName
      ? t('backlinks.historyTitle', { name: noteName })
      : noteName
        ? t('backlinks.noteTitle', { name: noteName })
        : null;
  const loading = isWixiv ? wikixivLoading : isGraphAnalysis ? analysisLoading : linksLoading;
  const waitingForIndex = hasDocument && !isWixiv && !indexReady;
  const heading = t(isWixiv
    ? 'wikixiv.heading'
    : isGraphAnalysis
      ? 'analysis.noteColumn'
      : mode === 'backlinks'
        ? 'backlinks.mentionsTitle'
        : 'backlinks.outgoingTitle');
  const emptyText = t(isWixiv
    ? 'wikixiv.empty'
    : isGraphAnalysis
      ? 'analysis.empty'
      : mode === 'backlinks'
        ? 'backlinks.empty'
        : 'backlinks.outgoingEmpty');
  const analysisReasonLabel = activeSourceMethod === 'adamicAdar'
    ? t('analysis.commonNeighbors')
    : activeSourceMethod === 'duplicates'
      ? t('analysis.similarity')
      : activeSourceMethod === 'unlinkedMentions'
        ? t('analysis.mention')
        : t('analysis.commonTerms');
  const analysisValueLabel = t('analysis.scoreColumn');
  const linkEmpty = linkResult !== null && linkResult.items.length === 0;
  const analysisEmpty = analysisItems !== null && analysisItems.length === 0;
  const notice = isWixiv
    ? wikixivOffline
      ? t('wikixiv.offline')
      : wikixivFailed
        ? t('wikixiv.error')
        : wikixivInsufficient
          ? t('wikixiv.insufficient')
          : null
    : isGraphAnalysis && analysisFailed
      ? t('analysis.error')
      : null;

  return (
    <aside
      className={`q-collapsible-panel q-backlinks ${isOpen ? '' : 'is-collapsed'}`}
      aria-hidden={!isOpen}
      aria-label={t('backlinks.panelTitle')}
      data-side="Right"
    >
      <div className="q-panel-header" data-tauri-drag-region>
        <div className="q-backlinks__mode-tabs" role="group" aria-label={t('backlinks.modeLabel')}>
          {MODE_TABS
            .filter((tab) => tab.mode !== 'analysis' || sourcesAvailable)
            .map((tab) => (
              <IconButton
                key={tab.mode}
                label={t(tab.label)}
                className="q-backlinks__mode-button"
                aria-pressed={mode === tab.mode}
                onClick={() => setMode(tab.mode)}
              >
                <Icon icon={tab.icon} />
              </IconButton>
            ))}
        </div>
      </div>

      {scope !== null && (
        <p className="q-backlinks__scope" title={scope}>
          <Icon icon={isVault ? 'analytics' : 'file'} size={12} className="q-backlinks__scope-icon" />
          <span className="q-backlinks__scope-name">{scope}</span>
        </p>
      )}

      {isAnalysis && (
        <div className="q-backlinks__chips">
          <div
            ref={chipRowRef}
            className="q-backlinks__chip-row"
            role="group"
            aria-label={t('analysis.methodLabel')}
          >
            {sidebarMethods.map((method) => (
              <Chip
                key={method}
                label={sourceMethodLabel(method)}
                selected={activeSourceMethod === method}
                onClick={() => setSourceMethod(method)}
              />
            ))}
          </div>
        </div>
      )}

      {isVault && (
        <div className="q-backlinks__content">
          {workspacePath ? (
            <InsightsPanel
              active={isOpen}
              workspacePath={workspacePath}
              onOpenNote={openNote}
              heading={false}
              activity={<ActivityHeatmap workspacePath={workspacePath} onOpenNote={openNote} />}
            />
          ) : (
            <p className="q-panel-empty q-panel-empty--wrap">{t('graph.noWorkspace')}</p>
          )}
        </div>
      )}

      {!isVault && !hasDocument && (
        <div className="q-backlinks__content">
          <p className="q-panel-empty q-panel-empty--wrap">{t('backlinks.noNote')}</p>
        </div>
      )}

      {hasDocument && isHistory && documentPath && (
        <div className="q-backlinks__content">
          <header className="q-backlinks__header">
            <h2>{t('history.title')}</h2>
          </header>
          <HistoryList path={documentPath} tabId={activeTabId} isOpen={isOpen} />
        </div>
      )}

      {hasDocument && isLocalGraph && workspacePath && documentPath && (
        <LocalGraph
          workspacePath={workspacePath}
          documentPath={documentPath}
          indexReady={indexReady}
          indexRevision={indexRevision}
          isOpen={isOpen}
          onOpen={onOpenLocalGraph}
        />
      )}

      {hasDocument && (isLinks || isAnalysis) && (
        <div className="q-backlinks__content">
          <header className="q-backlinks__header">
            <h2>{heading}</h2>
            {isGraphAnalysis && (
              <span className="q-panel-counter">{analysisValueLabel}</span>
            )}
          </header>
          {(loading || waitingForIndex) && (
            <PanelStatus
              state={loading ? 'loading' : 'waiting'}
              text={loading ? t('backlinks.loading') : t('search.indexing')}
            />
          )}
          {!loading && !waitingForIndex && (
            <>
              {(isLinks && linkEmpty) || (isGraphAnalysis && !analysisFailed && analysisEmpty) || (isWixiv && notice === null && wikixivHits.length === 0) ? (
                <p className="q-panel-empty">{emptyText}</p>
              ) : null}
              {notice !== null && (
                <p className="q-panel-empty q-panel-empty--wrap">{notice}</p>
              )}
            </>
          )}
          {linkResult?.mode === 'backlinks' && linkResult.items.map((link) => (
            <SidebarDocumentItem
              key={`${link.path}:${link.offset}`}
              label={link.title}
              onClick={(event) => onOpenBacklink(link, dispositionFromEvent(event))}
            />
          ))}
          {linkResult?.mode === 'outgoing' && linkResult.items.map((link, index) => (
            <SidebarDocumentItem
              key={`${link.target}:${index}`}
              label={link.title}
              onClick={(event) => onOpenOutgoing(link, dispositionFromEvent(event))}
            />
          ))}
          {isGraphAnalysis && analysisItems?.map((result) => {
            const showHover = () => setWikiHover({ filename: false, terms: result.reasons });
            return (
              <SidebarDocumentItem
                key={result.path}
                label={result.title}
                counter={analysisCounter(result, activeSourceMethod)}
                title={result.reasons.length > 0
                  ? `${result.title}\n${analysisReasonLabel}: ${result.reasons.join(', ')}`
                  : result.title}
                onClick={(event) => onOpenAnalysis(result, dispositionFromEvent(event))}
                onMouseEnter={showHover}
                onMouseLeave={clearWikiHover}
                onFocus={showHover}
                onBlur={clearWikiHover}
              />
            );
          })}
          {isWixiv && wikixivHits.map((hit) => {
            const showHover = () =>
              setWikiHover({ filename: hit.fromFilename, terms: hit.matchedTerms });
            return (
              <SidebarDocumentItem
                key={hit.url}
                label={hit.title}
                title={hit.snippet ? `${hit.title}\n\n${hit.snippet}` : hit.title}
                onClick={() => {
                  void openExternalUrl(hit.url).catch((error) => {
                    console.error('Failed to open Wiki url', error);
                  });
                }}
                onMouseEnter={showHover}
                onMouseLeave={clearWikiHover}
                onFocus={showHover}
                onBlur={clearWikiHover}
              />
            );
          })}
        </div>
      )}
    </aside>
  );
}

export const BacklinksPanel = memo(BacklinksPanelComponent);
