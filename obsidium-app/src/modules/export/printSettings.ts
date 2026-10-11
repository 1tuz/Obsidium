import type { MarkdownReadingSettings } from '../settings';

export function printReadingProperties(settings?: MarkdownReadingSettings): Record<string, string> | undefined {
  if (!settings || settings.style === 'theme') return undefined;
  return {
    '--q-print-font-family': settings.font === 'book'
      ? 'Georgia, "Times New Roman", serif'
      : 'var(--q-editor-font-family)',
    '--q-print-font-size': `${settings.fontSizePx}px`,
    '--q-print-line-height': String(settings.lineHeight),
    '--q-print-page-width': `${settings.pageWidthCh}ch`,
  };
}
