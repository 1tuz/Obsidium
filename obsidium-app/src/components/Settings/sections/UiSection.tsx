import { useRef, useState } from 'react';
import { SegmentedControl } from '../../Common/SegmentedControl';
import { resolveLocale, t } from '../../../i18n';
import type { AppConfig } from '../../../modules/settings';
import { getThemePalettes, themePalettes } from '../../../modules/theme';
import { parseThemePaletteImport } from '../../../modules/theme/import';
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
import { Icon } from '../../Common/Icon';
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
  const [paletteImportError, setPaletteImportError] = useState('');
  const importInputRef = useRef<HTMLInputElement>(null);
  const latestConfig = useRef(config);
  const importQueue = useRef(Promise.resolve());
  latestConfig.current = config;
  const palettes = getThemePalettes(config.ui.customPalettes ?? []);
  const patchUi = (partial: Partial<AppConfig['ui']>) => {
    const nextConfig = {
      ...latestConfig.current,
      ui: { ...latestConfig.current.ui, ...partial },
    };
    latestConfig.current = nextConfig;
    onChange(nextConfig);
  };

  return (
    <>
      <Section title={t('settings.ui.display')}>
        <Row label={t('settings.ui.iconSet')} description={t('settings.ui.iconSetHint')}>
          <div className="q-icon-set-picker" role="group" aria-label={t('settings.ui.iconSet')}>
            {([
              ['lucide', 'search'],
              ['tabler', 'graph'],
              ['phosphor', 'book'],
            ] as const).map(([iconSet, icon]) => (
              <button
                key={iconSet}
                type="button"
                data-icon-set-choice={iconSet}
                aria-pressed={config.ui.iconSet === iconSet}
                onClick={() => patchUi({ iconSet })}
              >
                <Icon icon={icon} size={18} />
                <span>{t(`settings.ui.iconSet${iconSet[0].toUpperCase()}${iconSet.slice(1)}`)}</span>
              </button>
            ))}
          </div>
        </Row>
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
          <div className="q-theme-palette-actions">
            <Button data-testid="open-palette-chooser" onClick={() => setPaletteDialogOpen(true)}>
              {palettes.find(({ id }) => id === config.ui.palette)?.name ?? t('settings.ui.paletteChoose')}
            </Button>
            <Button data-testid="import-palette" onClick={() => importInputRef.current?.click()}>
              {t('settings.ui.paletteImport')}
            </Button>
            <input
              ref={importInputRef}
              data-testid="palette-import-file"
              type="file"
              accept=".tokens,.tokens.json,.json,application/json,application/design-tokens+json"
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                importQueue.current = importQueue.current.then(async () => {
                  if (file.size > 65_536) throw new Error('Palette file is too large');
                  const imported = parseThemePaletteImport(await file.text(), file.name);
                  const customPalettes = latestConfig.current.ui.customPalettes ?? [];
                  const sameIdPalette = customPalettes.find(({ id }) => id === imported.id);
                  const hasNameCollision = sameIdPalette
                    && sameIdPalette.name.normalize('NFKC').toLowerCase() !== imported.name.normalize('NFKC').toLowerCase();
                  if (themePalettes.some(({ id }) => id === imported.id) || hasNameCollision) {
                    let suffix = 2;
                    while (themePalettes.some(({ id }) => id === `${imported.id}-${suffix}`)
                      || customPalettes.some(({ id }) => id === `${imported.id}-${suffix}`)) suffix += 1;
                    imported.id = `${imported.id}-${suffix}`;
                  }
                  const existingIndex = customPalettes.findIndex(({ id }) => id === imported.id);
                  const nextPalettes = existingIndex < 0
                    ? [...customPalettes, imported]
                    : customPalettes.map((palette, index) => index === existingIndex ? imported : palette);
                  patchUi({ customPalettes: nextPalettes, palette: imported.id });
                  setPaletteImportError('');
                }).catch(() => setPaletteImportError(t('settings.ui.paletteImportError')));
              }}
            />
          </div>
          {paletteImportError && <p role="alert">{paletteImportError}</p>}
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
        customPalettes={config.ui.customPalettes ?? []}
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
