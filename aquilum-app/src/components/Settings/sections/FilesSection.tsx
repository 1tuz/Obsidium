import { useEffect, useState } from 'react';
import type { AppConfig } from '../../../modules/settings';
import { Row } from '../Row';
import { t } from '../../../i18n';
import { Section } from '../Section';
import { Input } from '../../Common/Input';
import { Switch } from '../../Common/Switch';
import { listVaultSnippets, type VaultSnippet } from '../../../modules/docs/vaultSnippets';

export function FilesSection({ config, workspacePath, onChange }: {
  config: AppConfig;
  workspacePath: string | null;
  onChange: (value: AppConfig) => void;
}) {
  const [snippets, setSnippets] = useState<VaultSnippet[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listVaultSnippets(workspacePath)
      .then((items) => {
        if (active) setSnippets(items);
      })
      .catch((error) => console.error('Failed to list vault CSS snippets', error))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workspacePath]);

  const toggleSnippet = (name: string, enabled: boolean) => {
    const current = config.ui.enabledSnippets ?? [];
    const enabledSnippets = enabled
      ? [...new Set([...current, name])]
      : current.filter((item) => item !== name);
    onChange({ ...config, ui: { ...config.ui, enabledSnippets } });
  };

  return <Section title={t('settings.files.section')}>
    <Row label={t('settings.files.folder')} description={t('settings.files.folderHint')}>
      <Input value={config.files.folder} ariaLabel={t('settings.files.folder')}
        onChange={(folder) => onChange({ ...config, files: { folder } })} />
    </Row>
    <Section title={t('settings.files.snippets')}>
      {!workspacePath ? <Row label={t('settings.files.noWorkspace')} /> : null}
      {loading ? <Row label={t('settings.loading')} /> : null}
      {!loading && workspacePath && snippets.length === 0
        ? <Row label={t('settings.files.noSnippets')} />
        : null}
      {snippets.map((snippet) => (
        <Row key={snippet.path} label={snippet.name}>
          <Switch
            checked={(config.ui.enabledSnippets ?? []).includes(snippet.name)}
            onChange={(enabled) => toggleSnippet(snippet.name, enabled)}
            label={t('settings.files.toggleSnippet', { name: snippet.name })}
          />
        </Row>
      ))}
    </Section>
  </Section>;
}
