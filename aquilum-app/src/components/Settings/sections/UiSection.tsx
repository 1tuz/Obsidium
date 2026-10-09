import { useState } from 'react';
import { SegmentedControl } from '../../Common/SegmentedControl';
import { resolveLocale, t } from '../../../i18n';
import type { AppConfig } from '../../../modules/settings';
import { themePalettes } from '../../../modules/theme';
import { FontSettingsRows } from '../FontSettingsRows';
import { Row } from '../Row';
import { NumberControl } from '../controls/NumberControl';
import { MAX_SCALE, MIN_SCALE, SCALE_STEP, setInterfaceScale, useInterfaceScale } from '../../../modules/scaling';
import { formatShortcut, SHORTCUTS } from '../../../config/shortcuts';
import { Section } from '../Section';
import { ColorControl } from '../controls/ColorControl';
import { Dropdown } from '../../Common/Dropdown';
import type { SettingsSectionProps } from '../types';
import { Input } from '../../Common/Input';
import { useThemeMode } from '../../../hooks/useThemeMode';
import { Button } from '../../Common/Button';
import { ThemePaletteDialog } from './ThemePaletteDialog';
import './UiSection.css';

interface UiSectionProps extends SettingsSectionProps {
  workspacePath: string | null;
  homePage: string;
  onHomePageChange: (value: string) => void;
}

export function UiSection({ config, workspacePath, homePage, onHomePageChange, onChange }: UiSectionProps) {
  const scale = useInterfaceScale();
  const activeMode = useThemeMode();
  const [paletteDialogOpen, setPaletteDialogOpen] = useState(false);
  const patchUi = (partial: Partial<AppConfig['ui']>) => onChange({
    ...config,
    ui: { ...config.ui, ...partial },
  });

  return (
    <>
      <Section title={t('settings.ui.display')}>
        <Row
          label={t('settings.ui.scale')}
          description={t('settings.ui.scaleHint', { reset: formatShortcut(SHORTCUTS.ZOOM_RESET) })}
        >
          <NumberControl
            ariaLabel={t('settings.ui.scale')}
            value={Math.round(scale * 100)}
            min={MIN_SCALE * 100}
            max={MAX_SCALE * 100}
            step={SCALE_STEP * 100}
            stepButtons
            onChange={(percent) => setInterfaceScale(percent / 100)}
          />
        </Row>
        <Row label={t('settings.ui.theme')}>
          <SegmentedControl
            value={config.ui.appearance}
            onChange={(appearance) => patchUi({ appearance: appearance as AppConfig['ui']['appearance'] })}
            options={[
              { value: 'system', label: t('theme.system') },
              { value: 'light', label: t('theme.light') },
              { value: 'dark', label: t('theme.dark') },
            ]}
          />
        </Row>
        <Row label={t('settings.ui.palette')}>
          <Button data-testid="open-palette-chooser" onClick={() => setPaletteDialogOpen(true)}>
            {themePalettes.find(({ id }) => id === config.ui.palette)?.name ?? t('settings.ui.paletteChoose')}
          </Button>
        </Row>
        <Row label={t('settings.ui.accentMode')}>
          <SegmentedControl
            value={config.ui.accentMode}
            onChange={(accentMode) => patchUi({ accentMode: accentMode as AppConfig['ui']['accentMode'] })}
            options={[
              { value: 'palette', label: t('settings.ui.paletteAccent') },
              { value: 'custom', label: t('settings.ui.customAccent') },
            ]}
          />
        </Row>
        <Row
          label={t('settings.ui.animations')}
          description={t('settings.ui.motionHint')}
        >
          <SegmentedControl
            value={config.ui.motion}
            onChange={(motion) => patchUi({ motion: motion as AppConfig['ui']['motion'] })}
            options={[
              { value: 'system', label: t('settings.ui.motionAuto') },
              { value: 'on', label: t('theme.on') },
              { value: 'off', label: t('theme.off') },
            ]}
          />
        </Row>
        <Row label={t('settings.ui.language')}>
          <Dropdown
            ariaLabel={t('settings.ui.languageAria')}
            value={resolveLocale(config.ui.language)}
            options={[
              { value: 'ru', label: 'Русский' },
              { value: 'en', label: 'English' },
            ]}
            onChange={(language) => patchUi({ language })}
          />
        </Row>
        <Row
          label={t('settings.ui.homePage')}
          description={t('settings.ui.homePageHint')}
        >
          <Input
            value={homePage}
            ariaLabel={t('settings.ui.homePageAria')}
            disabled={!workspacePath}
            onChange={onHomePageChange}
          />
        </Row>
        {config.ui.accentMode === 'custom' ? (
          <Row label={t('settings.ui.primaryColor')}>
            <ColorControl
              ariaLabel={t('settings.ui.primaryColor')}
              value={config.ui.primaryColor}
              onChange={(primaryColor) => patchUi({ primaryColor })}
            />
          </Row>
        ) : null}
      </Section>
      <ThemePaletteDialog
        open={paletteDialogOpen}
        activeMode={activeMode}
        selectedPalette={config.ui.palette}
        onSelect={(palette) => {
          patchUi({ palette });
          setPaletteDialogOpen(false);
        }}
        onClose={() => setPaletteDialogOpen(false)}
      />
      <Section title={t('settings.font.section')}>
        <FontSettingsRows
          scope="ui"
          font={config.ui}
          onChange={patchUi}
        />
      </Section>
    </>
  );
}
