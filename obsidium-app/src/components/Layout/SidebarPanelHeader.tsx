import { Plus } from 'lucide';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import './SidebarPanelHeader.css';

interface SidebarPanelHeaderProps {
  title: string;
  createLabel: string;
  disabled?: boolean;
  onCreate: () => void;
}

export function SidebarPanelHeader({ title, createLabel, disabled, onCreate }: SidebarPanelHeaderProps) {
  return (
    <header className="q-sidebar-panel-header">
      <h2 title={title}>{title}</h2>
      <IconButton
        className="q-sidebar-panel-header__action"
        label={createLabel}
        size="medium"
        disabled={disabled}
        onClick={onCreate}
      >
        <Icon icon={Plus} size={20} />
      </IconButton>
    </header>
  );
}
