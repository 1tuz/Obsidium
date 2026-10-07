import { lazy, Suspense } from 'react';
import type { AppConfig } from '../../modules/settings';
import type { SettingsSectionId } from './types';
import { t } from '../../i18n';

const AnalysisSection = lazy(() => import('./sections/AnalysisSection').then((module) => ({ default: module.AnalysisSection })));
const EditorSection = lazy(() => import('./sections/EditorSection').then((module) => ({ default: module.EditorSection })));
const McpSection = lazy(() => import('./sections/McpSection').then((module) => ({ default: module.McpSection })));
const ReaderSection = lazy(() => import('./sections/ReaderSection').then((module) => ({ default: module.ReaderSection })));
const HistorySection = lazy(() => import('./sections/HistorySection').then((module) => ({ default: module.HistorySection })));
const TrashSection = lazy(() => import('./sections/TrashSection').then((module) => ({ default: module.TrashSection })));
const SearchSection = lazy(() => import('./sections/SearchSection').then((module) => ({ default: module.SearchSection })));
const ShortcutsSection = lazy(() => import('./sections/ShortcutsSection').then((module) => ({ default: module.ShortcutsSection })));
const SystemSection = lazy(() => import('./sections/SystemSection').then((module) => ({ default: module.SystemSection })));
const UiSection = lazy(() => import('./sections/UiSection').then((module) => ({ default: module.UiSection })));
const TemplatesSection = lazy(() => import('./sections/TemplatesSection').then((module) => ({ default: module.TemplatesSection })));
const FilesSection = lazy(() => import('./sections/FilesSection').then((module) => ({ default: module.FilesSection })));

interface SettingsFormProps {
  config: AppConfig | null;
  section: SettingsSectionId;
  workspacePath: string | null;
  homePage: string;
  onHomePageChange: (value: string) => void;
  onChange: (next: AppConfig) => void;
}

export function SettingsForm({
  config,
  section,
  workspacePath,
  homePage,
  onHomePageChange,
  onChange,
}: SettingsFormProps) {
  if (section === 'shortcuts') {
    return <Suspense fallback={<div className="q-settings-loading">{t('settings.loading')}</div>}><ShortcutsSection /></Suspense>;
  }
  if (!config) return null;

  let content;
  switch (section) {
    case 'ui':
      content = (
        <UiSection
          config={config}
          workspacePath={workspacePath}
          homePage={homePage}
          onHomePageChange={onHomePageChange}
          onChange={onChange}
        />
      );
      break;
    case 'editor':
      content = <EditorSection config={config} onChange={onChange} />;
      break;
    case 'reader':
      content = <ReaderSection config={config} onChange={onChange} />;
      break;
    case 'search':
      content = <SearchSection config={config} onChange={onChange} />;
      break;
    case 'templates':
      content = <TemplatesSection config={config} workspacePath={workspacePath} onChange={onChange} />;
      break;
    case 'files':
      content = <FilesSection config={config} workspacePath={workspacePath} onChange={onChange} />;
      break;
    case 'analysis':
      content = <AnalysisSection config={config} onChange={onChange} />;
      break;
    case 'mcp':
      content = <McpSection config={config} />;
      break;
    case 'history':
      content = <HistorySection config={config} onChange={onChange} />;
      break;
    case 'system':
      content = <SystemSection config={config} onChange={onChange} />;
      break;
    case 'trash':
      content = <TrashSection config={config} workspacePath={workspacePath} onChange={onChange} />;
      break;
  }
  return <Suspense fallback={<div className="q-settings-loading">{t('settings.loading')}</div>}>{content}</Suspense>;
}
