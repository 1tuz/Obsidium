import type { ReactNode } from 'react';
import {
  BookOpen,
  History,
  Keyboard,
  Monitor,
  Plug,
  Power,
  Search,
  Trash2,
  Type,
  FileText,
  Paperclip,
} from 'lucide-react';
import { t } from '../../i18n';
import { GraphAnalysisIcon } from '../Icons/LinkIcons';
import type { SettingsSectionId } from './types';

export function settingsSections(): { id: SettingsSectionId; label: string }[] {
  return [
    { id: 'ui', label: t('settings.nav.ui') },
    { id: 'editor', label: t('settings.nav.editor') },
    { id: 'reader', label: t('settings.nav.reader') },
    { id: 'search', label: t('settings.nav.search') },
    { id: 'templates', label: t('settings.nav.templates') },
    { id: 'files', label: t('settings.nav.files') },
    { id: 'analysis', label: t('settings.nav.analysis') },
    { id: 'mcp', label: t('settings.nav.mcp') },
    { id: 'history', label: t('settings.nav.history') },
    { id: 'trash', label: t('settings.nav.trash') },
    { id: 'system', label: t('settings.nav.system') },
    { id: 'shortcuts', label: t('settings.nav.shortcuts') },
  ];
}

export const SETTINGS_SECTION_ICONS: Record<SettingsSectionId, ReactNode> = {
  ui: <Monitor />,
  editor: <Type />,
  reader: <BookOpen />,
  search: <Search />,
  templates: <FileText />,
  files: <Paperclip />,
  analysis: <GraphAnalysisIcon />,
  mcp: <Plug />,
  history: <History />,
  trash: <Trash2 />,
  system: <Power />,
  shortcuts: <Keyboard />,
};
