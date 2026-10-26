import type { IconId } from '../Common/iconCatalog';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { t } from '../../i18n';
import './SidebarRail.css';

export type RailSectionId = 'home' | 'files' | 'boards' | 'calendar' | 'canvas' | 'graph';

interface SidebarRailProps {
  isSidebarOpen: boolean;
  onToggleSidebar?: () => void;
  sections: readonly RailSectionId[];
  activeSection: RailSectionId | null;
  onSelect: (id: RailSectionId) => void;
  onOpenSettings?: () => void;
}

const SECTION_CONTROLS: Record<RailSectionId, { icon: IconId; label: string; action: boolean }> = {
  home: { icon: 'house', label: 'rail.home', action: true },
  files: { icon: 'files', label: 'rail.fileManager', action: false },
  boards: { icon: 'kanban', label: 'rail.boards', action: false },
  calendar: { icon: 'calendar', label: 'rail.calendar', action: false },
  canvas: { icon: 'canvas', label: 'rail.canvas', action: false },
  graph: { icon: 'graph', label: 'rail.graph', action: true },
};

export function SidebarRail({
  isSidebarOpen,
  onToggleSidebar,
  sections,
  activeSection,
  onSelect,
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
            <Icon icon="panel-left" />
          </IconButton>
        )}
      </div>
      <div className="q-sidebar-rail-tools">
        {sections.map((id) => {
          const control = SECTION_CONTROLS[id];
          return (
            <IconButton
              key={id}
              label={t(control.label)}
              size="medium"
              {...(control.action ? {} : { 'aria-pressed': activeSection === id })}
              onClick={() => onSelect(id)}
            >
              <Icon icon={control.icon} />
            </IconButton>
          );
        })}
        {onOpenSettings && (
          <IconButton
            className="q-sidebar-rail-settings"
            label={t('common.settings')}
            size="medium"
            onClick={onOpenSettings}
          >
            <Icon icon="settings" />
          </IconButton>
        )}
      </div>
    </aside>
  );
}
