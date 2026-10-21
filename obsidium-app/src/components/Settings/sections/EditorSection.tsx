import {
  DEFAULT_EDITOR_MAX_WIDTH_CH,
  DEFAULT_LINK_SUGGEST_MIN_CHARS,
  DEFAULT_LIVE_TABS,
  type AppConfig,
} from '../../../modules/settings';
import { Switch } from '../../Common/Switch';
import { t } from '../../../i18n';
import { FontSettingsRows } from '../FontSettingsRows';
import { Row } from '../Row';
import { Section } from '../Section';
import { NumberControl } from '../controls/NumberControl';
import { SegmentedControl } from '../../Common/SegmentedControl';
import type { SettingsSectionProps } from '../types';
import './EditorSection.css';

const SAVE_INTERVAL_SECONDS = [5, 10, 30, 60, 300] as const;

export function EditorSection({ config, onChange }: SettingsSectionProps) {
  const patchEditor = (partial: Partial<AppConfig['editor']>) => onChange({
    ...config,
    editor: { ...config.editor, ...partial },
  });
  const reading = config.editor.markdownReading;
  const patchReading = (partial: Partial<AppConfig['editor']['markdownReading']>) => patchEditor({
    markdownReading: { ...reading, ...partial },
  });

  return (
    <>
      <Section title={t('settings.editor.readingStyle')}>
        <Row label={t('settings.editor.paperStyle')} description={t('settings.editor.paperStyleHint')}>
          <div className="q-markdown-reading-styles" role="group" aria-label={t('settings.editor.paperStyle')}>
            {(['theme', 'paper-white', 'ivory', 'parchment', 'sepia', 'dark-paper'] as const).map((style) => (
              <button
                key={style}
                type="button"
                className="q-markdown-reading-style"
                data-style={style}
                aria-label={t(`settings.editor.styles.${style}`)}
                aria-pressed={reading.style === style}
                onClick={() => patchReading({ style })}
              >
                <span className="q-markdown-reading-style__page" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className="q-markdown-reading-style__label">{t(`settings.editor.styles.${style}`)}</span>
              </button>
            ))}
          </div>
        </Row>
        <Row label={t('settings.editor.paperTexture')}>
          <SegmentedControl
            value={reading.texture}
            onChange={(texture) => patchReading({ texture: texture as AppConfig['editor']['markdownReading']['texture'] })}
            options={[
              { value: 'off', label: t('settings.editor.textureOff') },
              { value: 'subtle', label: t('settings.editor.textureSubtle') },
              { value: 'visible', label: t('settings.editor.textureVisible') },
            ]}
          />
        </Row>
        <Row label={t('settings.editor.readingFont')}>
          <SegmentedControl
            value={reading.font}
            onChange={(font) => patchReading({ font: font as AppConfig['editor']['markdownReading']['font'] })}
            options={[
              { value: 'standard', label: t('settings.editor.fontStandard') },
              { value: 'book', label: t('settings.editor.fontBook') },
            ]}
          />
        </Row>
        <Row label={t('settings.editor.readingFontSize')}>
          <NumberControl ariaLabel={t('settings.editor.readingFontSize')} value={reading.fontSizePx} min={14} max={24} onChange={(fontSizePx) => patchReading({ fontSizePx })} />
        </Row>
        <Row label={t('settings.editor.readingLineHeight')}>
          <NumberControl ariaLabel={t('settings.editor.readingLineHeight')} value={reading.lineHeight} min={1.35} max={2.1} step={0.05} onChange={(lineHeight) => patchReading({ lineHeight })} />
        </Row>
        <Row label={t('settings.editor.readingPageWidth')}>
          <NumberControl ariaLabel={t('settings.editor.readingPageWidth')} value={reading.pageWidthCh} min={45} max={220} onChange={(pageWidthCh) => patchReading({ pageWidthCh })} />
        </Row>
      </Section>
      <Section title={t('settings.font.section')}>
        <FontSettingsRows
          scope="editor"
          font={config.editor}
          onChange={patchEditor}
        />
        <Row label={t('settings.editor.lineHeight')}>
          <NumberControl
            ariaLabel={t('settings.editor.lineHeight')}
            value={config.editor.lineHeight}
            min={1.2}
            max={2}
            step={0.05}
            onChange={(lineHeight) => patchEditor({ lineHeight })}
          />
        </Row>
      </Section>
      <Section title={t('settings.editor.layout')}>
        <Row label={t('settings.editor.fullWidth')} description={t('settings.editor.fullWidthHint')}>
          <Switch
            checked={config.editor.fullWidth === true}
            label={t('settings.editor.fullWidth')}
            onChange={(fullWidth) => patchEditor({ fullWidth })}
          />
        </Row>
        <Row label={t('settings.editor.maxWidth')} description={t('settings.editor.maxWidthHint')}>
          <NumberControl
            ariaLabel={t('settings.editor.maxWidthAria')}
            value={config.editor.maxWidthCh ?? DEFAULT_EDITOR_MAX_WIDTH_CH}
            min={40}
            max={220}
            step={1}
            onChange={(maxWidthCh) => patchEditor({ maxWidthCh })}
          />
        </Row>
      </Section>
      <Section title={t('settings.editor.tabs')}>
        <Row
          label={t('settings.editor.liveTabs')}
          description={t('settings.editor.liveTabsHint')}
        >
          <NumberControl
            ariaLabel={t('settings.editor.liveTabs')}
            value={config.editor.liveTabs ?? DEFAULT_LIVE_TABS}
            min={1}
            max={8}
            step={1}
            onChange={(liveTabs) => patchEditor({ liveTabs })}
          />
        </Row>
      </Section>
      <Section title={t('settings.editor.input')}>
        <Row label={t('settings.editor.smartDashes')} description={t('settings.editor.smartDashesHint')}>
          <Switch
            checked={config.editor.smartDashes}
            label={t('settings.editor.smartDashes')}
            onChange={(smartDashes) => patchEditor({ smartDashes })}
          />
        </Row>
        <Row
          label={t('settings.editor.listCallouts')}
          description={t('settings.editor.listCalloutsHint')}
        >
          <Switch
            checked={config.editor.listCallouts ?? true}
            label={t('settings.editor.listCallouts')}
            onChange={(listCallouts) => patchEditor({ listCallouts })}
          />
        </Row>
        <Row
          label={t('settings.editor.autoLinkTitle')}
          description={t('settings.editor.autoLinkTitleHint')}
        >
          <Switch
            checked={config.editor.autoLinkTitle ?? true}
            label={t('settings.editor.autoLinkTitle')}
            onChange={(autoLinkTitle) => patchEditor({ autoLinkTitle })}
          />
        </Row>
      </Section>
      <Section title={t('settings.editor.completion')}>
        <Row
          label={t('settings.editor.linkSuggest')}
          description={t('settings.editor.linkSuggestHint')}
        >
          <Switch
            checked={config.editor.linkSuggest ?? true}
            label={t('settings.editor.linkSuggest')}
            onChange={(linkSuggest) => patchEditor({ linkSuggest })}
          />
        </Row>
        <Row label={t('settings.editor.minChars')} description={t('settings.editor.minCharsHint')}>
          <NumberControl
            ariaLabel={t('settings.editor.minChars')}
            value={config.editor.linkSuggestMinChars ?? DEFAULT_LINK_SUGGEST_MIN_CHARS}
            min={1}
            max={5}
            step={1}
            onChange={(linkSuggestMinChars) => patchEditor({ linkSuggestMinChars })}
          />
        </Row>
      </Section>
      <Section title={t('settings.editor.saving')}>
        <Row label={t('settings.editor.saveDebounce')}>
          <div role="group" aria-label={t('settings.editor.saveDebounceAria')}>
            <SegmentedControl
              className="q-editor-save-interval"
              options={SAVE_INTERVAL_SECONDS.map((seconds) => ({
                value: String(seconds * 1000),
                label: t('settings.editor.saveSeconds', { count: seconds }),
              }))}
              value={String(config.editor.saveDebounceMs)}
              onChange={(value) => patchEditor({ saveDebounceMs: Number(value) })}
            />
          </div>
        </Row>
      </Section>
    </>
  );
}
