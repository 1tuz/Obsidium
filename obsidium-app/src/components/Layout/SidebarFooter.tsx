import { ChevronsUpDown, Moon, Settings, Sun } from 'lucide';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { t } from '../../i18n';
import { useThemeMode } from '../../hooks/useThemeMode';

interface SidebarFooterProps {
  workspaceName: string;
  workspacePath: string | null;
  onOpenSettings: () => void;
  onOpenWorkspaces: () => void;
  onToggleTheme: () => void;
}

export function SidebarFooter({
  workspaceName,
  workspacePath,
  onOpenSettings,
  onOpenWorkspaces,
  onToggleTheme,
}: SidebarFooterProps) {
  const themeMode = useThemeMode();

  return (
    <div className="q-sidebar-footer">
      <button
        type="button"
        className="q-file-item q-sidebar-footer-tab"
        onClick={onOpenWorkspaces}
        title={t('workspace.switch')}
      >
        <span className="q-file-icon" aria-hidden="true">
          <Icon icon={ChevronsUpDown} />
        </span>
        <span className="q-sidebar-footer-title" title={workspacePath || ''}>
          {workspaceName}
        </span>
      </button>
      <IconButton
        label={t(themeMode === 'dark' ? 'titlebar.switchToLightTheme' : 'titlebar.switchToDarkTheme')}
        onClick={onToggleTheme}
      >
        <Icon icon={themeMode === 'dark' ? Sun : Moon} />
      </IconButton>
      <IconButton label={t('common.settings')} onClick={onOpenSettings}>
        <Icon icon={Settings} />
      </IconButton>
    </div>
  );
}
