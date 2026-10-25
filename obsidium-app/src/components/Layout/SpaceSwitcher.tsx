import { Settings2 } from 'lucide';
import { Dropdown } from '../Common/Dropdown';
import { Icon } from '../Common/Icon';
import { IconButton } from '../Common/IconButton';
import { t } from '../../i18n';
import type { Space } from '../../modules/spaces';

interface SpaceSwitcherProps {
  spaces: Space[];
  activeSpaceId: string;
  onSelect: (id: string) => void;
  onManage: () => void;
}

export function SpaceSwitcher({ spaces, activeSpaceId, onSelect, onManage }: SpaceSwitcherProps) {
  const options = spaces.map((space) => ({ value: space.id, label: space.name }));
  return (
    <div className="q-sidebar-spaces" data-space-switcher>
      <Dropdown
        value={activeSpaceId}
        options={options}
        onChange={onSelect}
        ariaLabel={t('spaces.switcher')}
      />
      <IconButton size="small" label={t('spaces.manage')} onClick={onManage}>
        <Icon icon={Settings2} />
      </IconButton>
    </div>
  );
}
