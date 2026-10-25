import type { AppConfig } from '../../../modules/settings';
import { Row } from '../Row';
import { t } from '../../../i18n';
import { Section } from '../Section';
import { Input } from '../../Common/Input';

export function JournalSection({ config, onChange }: {
  config: AppConfig;
  onChange: (value: AppConfig) => void;
}) {
  const patch = (partial: Partial<AppConfig['journal']>) => onChange({
    ...config,
    journal: { ...config.journal, ...partial },
  });

  return <Section title={t('settings.journal.section')}>
    <Row label={t('settings.journal.folder')} description={t('settings.journal.folderHint')}>
      <Input
        value={config.journal.folder}
        ariaLabel={t('settings.journal.folder')}
        onChange={(folder) => patch({ folder })}
      />
    </Row>
    <Row label={t('settings.journal.dateFormat')} description={t('settings.journal.dateFormatHint')}>
      <Input
        value={config.journal.dateFormat}
        ariaLabel={t('settings.journal.dateFormat')}
        onChange={(dateFormat) => patch({ dateFormat })}
      />
    </Row>
    <Row label={t('settings.journal.template')} description={t('settings.journal.templateHint')}>
      <Input
        value={config.journal.templatePath ?? ''}
        ariaLabel={t('settings.journal.template')}
        placeholder={t('settings.journal.templatePlaceholder')}
        onChange={(templatePath) => patch({ templatePath: templatePath.trim() ? templatePath : null })}
      />
    </Row>
  </Section>;
}
