import { Switch } from '../../Common/Switch';
import { Dropdown } from '../../Common/Dropdown';
import { t } from '../../../i18n';
import {
  DEFAULT_BUILTINS,
  type BuiltinPluginSettings,
} from '../../../modules/settings';
import { Row } from '../Row';
import { Section } from '../Section';
import type { SettingsSectionProps } from '../types';

export function BuiltinsSection({ config, onChange }: SettingsSectionProps) {
  const builtins = { ...DEFAULT_BUILTINS, ...config.builtins };
  const patch = (value: Partial<BuiltinPluginSettings>) => onChange({
    ...config,
    builtins: { ...builtins, ...value },
  });

  return (
    <>
      <Section title={t('settings.builtins.section')}>
        <Row
          label={t('settings.builtins.toolbar')}
          description={t('settings.builtins.toolbarHint')}
        >
          <Switch
            checked={builtins.editingToolbar}
            label={t('settings.builtins.toolbar')}
            onChange={(editingToolbar) => patch({ editingToolbar })}
          />
        </Row>
        {builtins.editingToolbar ? (
          <Row label={t('settings.builtins.toolbarPosition')}>
            <Dropdown
              ariaLabel={t('settings.builtins.toolbarPosition')}
              value={builtins.toolbarPosition}
              options={[
                { value: 'top', label: t('settings.builtins.top') },
                { value: 'selection', label: t('settings.builtins.selection') },
              ]}
              onChange={(toolbarPosition) => patch({
                toolbarPosition: toolbarPosition as BuiltinPluginSettings['toolbarPosition'],
              })}
            />
          </Row>
        ) : null}
        <Row label={t('settings.builtins.kanban')}
          description={t('settings.builtins.kanbanHint')}>
          <Switch
            checked={builtins.kanban}
            label={t('settings.builtins.kanban')}
            onChange={(kanban) => patch({ kanban })}
          />
        </Row>
      </Section>
    </>
  );
}
