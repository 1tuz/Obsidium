import { useCallback, useEffect, useState } from 'react';
import type { AppConfig } from '../../../modules/settings';
import { clearUnusedSearchCache, getSearchCacheSize, rebuildSearchIndex } from '../../../modules/search';
import { Row } from '../Row';
import { t } from '../../../i18n';
import { Section } from '../Section';
import { NumberControl } from '../controls/NumberControl';
import type { SettingsSectionProps } from '../types';
import { TextButton } from '../../Common/TextButton';

interface SearchSectionProps extends SettingsSectionProps {
  workspacePath: string | null;
}

export function SearchSection({ config, onChange, workspacePath }: SearchSectionProps) {
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const refreshCacheSize = useCallback(() => {
    void getSearchCacheSize().then(setCacheSize).catch(() => setCacheSize(null));
  }, []);

  useEffect(refreshCacheSize, [refreshCacheSize]);

  const patchSearch = (partial: Partial<AppConfig['search']>) => onChange({
    ...config,
    search: { ...config.search, ...partial },
  });

  const clearCache = async () => {
    setBusy(true);
    setNotice('');
    try {
      const removed = await clearUnusedSearchCache();
      setNotice(t('settings.search.cacheCleared', { size: formatBytes(removed) }));
      refreshCacheSize();
    } catch {
      setNotice(t('settings.search.cacheOperationFailed'));
    } finally {
      setBusy(false);
    }
  };

  const rebuildIndex = async () => {
    if (!workspacePath) return;
    setBusy(true);
    setNotice('');
    try {
      await rebuildSearchIndex(workspacePath);
      refreshCacheSize();
    } catch {
      setNotice(t('settings.search.cacheOperationFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('settings.search.section')}>
      <Row label={t('settings.search.candidatePool')}>
        <NumberControl
          ariaLabel={t('settings.search.candidatePool')}
          value={config.search.candidatePoolSize}
          min={32}
          max={2048}
          step={32}
          onChange={(candidatePoolSize) => patchSearch({ candidatePoolSize })}
        />
      </Row>
      <Row label={t('settings.search.maxQueryTerms')}>
        <NumberControl
          ariaLabel={t('settings.search.maxQueryTerms')}
          value={config.search.maxQueryTerms}
          min={8}
          max={128}
          onChange={(maxQueryTerms) => patchSearch({ maxQueryTerms })}
        />
      </Row>
      <Row label={t('settings.search.cacheSize')}>
        {cacheSize === null ? t('settings.search.cacheSizeUnknown') : formatBytes(cacheSize)}
      </Row>
      <Row label={t('settings.search.clearUnusedCache')}>
        <TextButton disabled={busy} onClick={() => void clearCache()}>
          {t('settings.search.clearUnusedCache')}
        </TextButton>
      </Row>
      <Row label={t('settings.search.rebuildIndex')}>
        <TextButton disabled={busy || !workspacePath} onClick={() => void rebuildIndex()}>
          {t('settings.search.rebuildIndex')}
        </TextButton>
      </Row>
      {notice ? <p role="status">{notice}</p> : null}
    </Section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unit = -1;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
