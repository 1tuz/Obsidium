import { Dialog } from '../../Common/Dialog';
import { themePalettes, type ThemeMode } from '../../../modules/theme';
import { t } from '../../../i18n';

export function ThemePaletteDialog({
  open,
  activeMode,
  selectedPalette,
  onSelect,
  onClose,
}: {
  open: boolean;
  activeMode: ThemeMode;
  selectedPalette: string;
  onSelect: (palette: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      title={t('settings.ui.paletteDialogTitle')}
      closeLabel={t('settings.ui.paletteClose')}
      className="q-theme-palette-dialog"
      onClose={onClose}
    >
      <div className="q-theme-gallery" role="group" aria-label={t('settings.ui.palette')}>
        {themePalettes.map((palette) => {
          const colors = palette[activeMode];
          return (
            <button
              className="q-theme-card"
              type="button"
              key={palette.id}
              aria-pressed={selectedPalette === palette.id}
              onClick={() => onSelect(palette.id)}
            >
              <span className="q-theme-card__name">{palette.name}</span>
              <span className="q-theme-card__preview" style={{
                background: colors.background,
                color: colors.text,
                borderColor: colors.border,
              }}>
                <span className="q-theme-card__sidebar" style={{ background: colors.raised }} />
                <span className="q-theme-card__content" style={{ background: colors.surface }}>
                  <span className="q-theme-card__line" style={{ background: colors.secondaryText }} />
                  <span className="q-theme-card__line q-theme-card__line--short" style={{ background: colors.secondaryText }} />
                  <span className="q-theme-card__selection" style={{ background: colors.accent }} />
                </span>
              </span>
              <span className="q-theme-card__swatches" aria-hidden="true">
                {[colors.background, colors.raised, colors.text, colors.accent].map((color, index) => (
                  <span key={index} style={{ background: color }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
