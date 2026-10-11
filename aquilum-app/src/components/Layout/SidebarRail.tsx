import { Columns3, FilePlus2, FolderTree, House, Network, PanelLeft, Settings } from 'lucide';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { t } from '../../i18n';
import './SidebarRail.css';

interface SidebarRailProps {
  isSidebarOpen: boolean;
  onToggleSidebar?: () => void;
  onOpenGraph?: () => void;
  onOpenHome?: () => void;
  onOpenSettings?: () => void;
  onOpenBoards?: () => void;
  onOpenFiles?: () => void;
  onOpenCanvas?: () => void;
  boardsActive?: boolean;
  filesActive?: boolean;
  canvasActive?: boolean;
}

export function SidebarRail({
  isSidebarOpen,
  onToggleSidebar,
  onOpenGraph,
  onOpenHome,
  onOpenSettings,
  onOpenBoards,
  onOpenFiles,
  onOpenCanvas,
  boardsActive = false,
  filesActive = false,
  canvasActive = false,
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
            <Icon icon={PanelLeft} />
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
            <Icon icon={House} />
          </IconButton>
        )}
        {onOpenGraph && (
          <IconButton
            label={t('rail.graph')}
            size="medium"
            onClick={onOpenGraph}
          >
            <Icon icon={Network} />
          </IconButton>
        )}
        {onOpenBoards && (
          <IconButton
            label={t('rail.boards')}
            size="medium"
            aria-pressed={boardsActive}
            onClick={onOpenBoards}
          >
            <Icon icon={Columns3} />
          </IconButton>
        )}
        {onOpenFiles && (
          <IconButton
            label={t('rail.fileManager')}
            size="medium"
            aria-pressed={filesActive}
            onClick={onOpenFiles}
          >
            <Icon icon={FolderTree} />
          </IconButton>
        )}
        {onOpenCanvas && (
          <IconButton
            label={t('rail.canvas')}
            size="medium"
            aria-pressed={canvasActive}
            onClick={onOpenCanvas}
          >
            <Icon icon={FilePlus2} />
          </IconButton>
        )}
        {onOpenSettings && (
          <IconButton
            className="q-sidebar-rail-settings"
            label={t('common.settings')}
            size="medium"
            onClick={onOpenSettings}
          >
            <Icon icon={Settings} />
          </IconButton>
        )}
      </div>
    </aside>
  );
}
