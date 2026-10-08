import { Switch } from '../../Common/Switch';
import { Dropdown } from '../../Common/Dropdown';
import { ColorControl } from '../controls/ColorControl';
import { Button } from '../../Common/Button';
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
  const colors = builtins.highlightColors ?? DEFAULT_BUILTINS.highlightColors;
  const patchColors = (next: string[]) => patch({ highlightColors: next });

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
        <Row label={t('settings.builtins.highlightr')} description={t('settings.builtins.highlightrHint')}>
          <Switch checked={builtins.highlightr ?? true}
            label={t('settings.builtins.highlightr')}
            onChange={(highlightr) => patch({ highlightr })} />
        </Row>
        <Row label={t('settings.builtins.outliner')} description={t('settings.builtins.outlinerHint')}>
          <Switch checked={builtins.outliner ?? true}
            label={t('settings.builtins.outliner')}
            onChange={(outliner) => patch({ outliner })} />
        </Row>
        <Row label={t('settings.builtins.iconize')} description={t('settings.builtins.iconizeHint')}>
          <Switch checked={builtins.iconize ?? true}
            label={t('settings.builtins.iconize')}
            onChange={(iconize) => patch({ iconize })} />
        </Row>
        <Row label={t('settings.builtins.kanban')}
          description={t('settings.builtins.kanbanHint')}>
          <Switch
            checked={builtins.kanban}
            label={t('settings.builtins.kanban')}
            onChange={(kanban) => patch({ kanban })}
          />
        </Row>
        <Row label={t('settings.builtins.panes')} description={t('settings.builtins.panesHint')}>
          <Switch
            checked={builtins.panes}
            label={t('settings.builtins.panes')}
            onChange={(panes) => patch({ panes })}
          />
        </Row>
      </Section>
      {builtins.highlightr !== false && <Section title={t('settings.builtins.palette')}>
        {colors.map((color, index) => <Row key={`${index}-${color}`}
          label={t('settings.builtins.color', { index: index + 1 })}>
          <ColorControl ariaLabel={t('settings.builtins.color', { index: index + 1 })}
            value={color} onChange={(next) => {
              patchColors(colors.map((entry, i) => i === index ? next : entry));
            }} />
          <Button size="xs" variant="ghost" disabled={index === 0}
            onClick={() => {
              const next = [...colors];
              [next[index - 1], next[index]] = [next[index], next[index - 1]];
              patchColors(next);
            }}>{t('settings.builtins.moveUp')}</Button>
          <Button size="xs" variant="ghost" disabled={colors.length <= 1}
            onClick={() => patchColors(colors.filter((_, i) => i !== index))}>
            {t('settings.builtins.removeColor')}</Button>
        </Row>)}
        {colors.length < 24 && <Row label={t('settings.builtins.addColor')}>
          <Button size="xs" onClick={() => patchColors([...colors, '#ffe96b'])}>
            {t('settings.builtins.addColor')}</Button>
        </Row>}
      </Section>}
    </>
  );
}
