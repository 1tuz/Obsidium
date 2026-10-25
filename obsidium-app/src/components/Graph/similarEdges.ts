import type { AppConfig } from '../../modules/settings';

interface StoredGraphSettings {
  preferences?: unknown;
  presets?: unknown;
  similarEdges?: unknown;
}

export function readSimilarEdges(config: AppConfig | null): boolean | undefined {
  const value = (config?.graph as StoredGraphSettings | undefined)?.similarEdges;
  return typeof value === 'boolean' ? value : undefined;
}
