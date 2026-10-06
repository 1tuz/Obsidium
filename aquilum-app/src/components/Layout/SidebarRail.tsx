import { House, Network, PanelLeft, Settings } from 'lucide-react';
import { IconButton } from '../Common/IconButton';
import { t } from '../../i18n';
import './SidebarRail.css';

interface SidebarRailProps {
  isSidebarOpen: boolean;
  onToggleSidebar?: () => void;
  onOpenGraph?: () => void;
  onOpenHome?: () => void;
  onOpenSettings?: () => void;
}

export function SidebarRail({
  isSidebarOpen,
  onToggleSidebar,
  onOpenGraph,
  onOpenHome,
  onOpenSettings,
}: SidebarRailProps) {
  return (
    <aside className="q-sidebar-rail" aria-label={t('rail.toolbar')}>
      <div className="q-panel-header q-sidebar-rail-header" data-tauri-drag-region>
        {onToggleSidebar && (
          <IconButton
            label={isSidebarOpen ? t('rail.hideSidebar') : t('rail.showSidebar')}
            size="medium"
            aria-expanded={isSidebarOpen}
            onClick={onToggleSidebar}
          >
            <PanelLeft />
          </IconButton>
        )}
      </div>
      <div className="q-sidebar-rail-tools">
        {onOpenHome && (
          <IconButton
            label={t('rail.home')}
            size="medium"
            onClick={onOpenHome}
          >
            <House />
          </IconButton>
        )}
        {onOpenGraph && (
          <IconButton
            label={t('rail.graph')}
            size="medium"
            onClick={onOpenGraph}
          >
            <Network />
          </IconButton>
        )}
        {onOpenSettings && (
          <IconButton
            className="q-sidebar-rail-settings"
            label={t('common.settings')}
            size="medium"
            onClick={onOpenSettings}
          >
            <Settings />
          </IconButton>
        )}
      </div>
    </aside>
  );
}
