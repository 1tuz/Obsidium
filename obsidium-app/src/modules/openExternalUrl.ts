import { openUrl } from '@tauri-apps/plugin-opener';

export function normalizeExternalUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/^<|>$/g, '');
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function normalizeWebUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/^<|>$/g, '');
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export async function openExternalUrl(raw: string): Promise<void> {
  const url = normalizeExternalUrl(raw);
  if (!url) return;
  await openUrl(url);
}
