import { useRef } from 'react';
import { PanelRight, Plus } from 'lucide';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { useHorizontalWheelScroll } from '../Common/useHorizontalWheelScroll';
import { t } from '../../i18n';
import { isMacOs } from '../../modules/platform';
import { TitlebarTab, type TabFileActions } from './TitlebarTab';
import { useTabStrip } from './useTabStrip';
import './Titlebar.css';

interface TitlebarProps {
  paneId?: string;
  tabItems?: Array<{ tabId: string; path: string }>;
  activeFile?: string | null;
  openFiles?: string[];
  renamingPath?: string | null;
  tabActions?: TabFileActions;
  onSelect?: (path: string, tabId?: string) => void;
  onClose?: (path: string, tabId?: string) => void;
  onNewTab?: () => void;
  onReorder?: (from: number, to: number) => void;
  rightSidebarOpen?: boolean;
  onToggleRightSidebar?: () => void;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onClosePane?: () => void;
  onMoveTab?: (tabId: string, paneId: string, beforeTabId: string | null) => void;
}

export function Titlebar({
  paneId = 'main',
  tabItems,
  activeFile,
  openFiles = [],
  renamingPath = null,
  tabActions,
  onSelect,
  onClose,
  onNewTab,
  onReorder,
  rightSidebarOpen = true,
  onToggleRightSidebar,
  onSplitHorizontal,
  onSplitVertical,
  onClosePane,
  onMoveTab,
}: TitlebarProps) {
  const tabsRef = useRef<HTMLDivElement | null>(null);
  useTabStrip(tabsRef, (from, to) => onReorder?.(from, to), onMoveTab);
  useHorizontalWheelScroll(tabsRef, true, null);
  const tabs = tabItems ?? openFiles.map((path) => ({ tabId: '', path }));

  const inset = !isMacOs() && !rightSidebarOpen ? 'q-titlebar--trailing-inset' : '';
  const rightSidebarInset = !isMacOs() ? 'q-titlebar-right-sidebar--trailing-inset' : '';

  return (
    <div data-tauri-drag-region className={`q-titlebar ${inset}`.trim()}>
      <div
        className="q-titlebar-tabs"
        ref={tabsRef}
        data-pane-id={paneId}
      >
        {tabs.map(({ tabId, path }) => (
          <TitlebarTab
            key={tabId || path}
            tabId={tabId || undefined}
            path={path}
            isActive={path === activeFile}
            renaming={renamingPath === path}
            actions={tabActions}
            onSelect={(selectedPath) => onSelect?.(selectedPath, tabId || undefined)}
            onClose={(closedPath) => onClose?.(closedPath, tabId || undefined)}
          />
        ))}
      </div>

      <IconButton
        label={t('tabs.newTab')}
        size="medium"
        className="q-titlebar-new-tab"
        onClick={onNewTab}
      >
        <Icon icon={Plus} strokeWidth={1.5} />
      </IconButton>

      {onSplitHorizontal && <IconButton label={t('titlebar.splitSide')} size="medium" onClick={onSplitHorizontal}>↔</IconButton>}
      {onSplitVertical && <IconButton label={t('titlebar.splitBelow')} size="medium" onClick={onSplitVertical}>↕</IconButton>}
      {onClosePane && <IconButton label={t('titlebar.closePane')} size="medium" onClick={onClosePane}>×</IconButton>}

      <div className="q-titlebar-menu-wrapper">
        {onToggleRightSidebar && (
          <IconButton
            label={rightSidebarOpen ? t('titlebar.hideRightSidebar') : t('titlebar.showRightSidebar')}
            size="medium"
            className={`q-titlebar-right-sidebar ${rightSidebarInset}`.trim()}
            aria-expanded={rightSidebarOpen}
            onClick={onToggleRightSidebar}
          >
            <Icon icon={PanelRight} strokeWidth={1.5} />
          </IconButton>
        )}
      </div>
    </div>
  );
}
