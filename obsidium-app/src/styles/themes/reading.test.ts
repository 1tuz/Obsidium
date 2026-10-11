import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readingStyles = readFileSync(resolve(process.cwd(), 'src/styles/themes/reading.css'), 'utf8');
const paperColors = {
  'paper-white': '#FAF9F6',
  ivory: '#FAF8F3',
  parchment: '#F5F0E8',
  sepia: '#E8DFC8',
  'dark-paper': '#2E2E2E',
};
const commonCodeTokens = Object.fromEntries(
  [...(readingStyles.match(/\.q-editor-content\[data-reading-style\][^{}]*\{([^}]*)\}/u)?.[1] ?? '')
    .matchAll(/(--q-reading-code-[\w-]+):\s*(#[\da-f]{6});/giu)]
    .map(([, name, value]) => [name, value.toUpperCase()]),
);
const darkCodeTokens = Object.fromEntries(
  [...Array.from(readingStyles.matchAll(/\.q-editor-content\[data-reading-style="dark-paper"\][^{}]*\{([^}]*)\}/gu))
    .map((match) => match[1] ?? '')
    .slice(-1)[0]
    .matchAll(/(--q-reading-code-[\w-]+):\s*(#[\da-f]{6});/giu)]
    .map(([, name, value]) => [name, value.toUpperCase()]),
);

function styleTokens(style: string): Record<string, string> {
  const match = readingStyles.match(new RegExp(`\\.q-editor-content\\[data-reading-style="${style}"\\][^{}]*\\{([^}]*)\\}`, 'u'));
  if (!match) throw new Error(`Missing reading style ${style}`);
  return Object.fromEntries([...match[1].matchAll(/(--q-reading-[\w-]+):\s*(#[\da-f]{6});/giu)]
    .map(([, name, value]) => [name, value.toUpperCase()]));
}

function contrastRatio(first: string, second: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/[\da-f]{2}/giu)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [];
    const [red, green, blue] = channels.map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

describe('Markdown reading styles', () => {
  it('defines only the five fixed paper backgrounds', () => {
    expect(Object.keys(paperColors)).toHaveLength(5);
    for (const [style, background] of Object.entries(paperColors)) {
      expect(styleTokens(style)['--q-reading-paper']).toBe(background);
    }
  });

  it('keeps every normal-text role at WCAG AA contrast', () => {
    const textRoles = [
      ['--q-reading-ink', '--q-reading-paper'],
      ['--q-reading-heading', '--q-reading-paper'],
      ['--q-reading-link', '--q-reading-paper'],
      ['--q-reading-highlight-text', '--q-reading-highlight'],
      ['--q-reading-code-text', '--q-reading-code'],
      ['--q-reading-ink', '--q-reading-table'],
      ['--q-reading-selection-text', '--q-reading-selection'],
    ];
    for (const style of Object.keys(paperColors)) {
      const tokens = styleTokens(style);
      for (const [foreground, background] of textRoles) {
        expect(
          contrastRatio(tokens[foreground], tokens[background]),
          `${style} ${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps all highlighted code tokens at WCAG AA contrast on code surfaces', () => {
    const tokenNames = Object.keys(commonCodeTokens).filter((name) => name !== '--q-reading-code-text');
    expect(tokenNames).toHaveLength(7);
    for (const style of Object.keys(paperColors)) {
      const tokens = styleTokens(style);
      const overrides = style === 'dark-paper' ? darkCodeTokens : {};
      for (const name of tokenNames) {
        expect(
          contrastRatio(overrides[name] ?? commonCodeTokens[name], tokens['--q-reading-code']),
          `${style} ${name} on code background`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('scopes style tokens to the editor or canvas without overriding Highlightr marks', () => {
    for (const selector of readingStyles.matchAll(/(^|\n)([^\n{}]+)\s*\{/gu)) {
      for (const scope of selector[2].split(/,\s*\n/u)) {
        expect(scope.trim()).toMatch(/^(?:\.q-editor-content\[data-reading-style|\.q-canvas\[data-paper-style)/u);
      }
    }
    expect(readingStyles).toContain('[data-reading-texture="subtle"]');
    expect(readingStyles).toContain('[data-reading-texture="visible"]');
    expect(readingStyles).not.toMatch(/highlightr|\.q-md-highlight|\bmark\b/iu);
    expect(readingStyles).not.toMatch(/url\(|filter\s*:/iu);
  });
});
