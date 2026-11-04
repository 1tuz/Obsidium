import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const theme = readFileSync(resolve(process.cwd(), 'src/components/Editor/extensions/codeBlock/theme.ts'), 'utf8');

function rule(selector: string): string {
  const start = theme.indexOf(`'${selector}': {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return theme.slice(start, theme.indexOf('}', start));
}

describe('fenced code layout', () => {
  it('preserves spaces while wrapping long lines and unbroken identifiers', () => {
    const line = rule('.cm-line.q-md-code-line');
    expect(line).toMatch(/whiteSpace:\s*'pre-wrap'/u);
    expect(line).toMatch(/overflowWrap:\s*'anywhere'/u);
  });

  it('keeps controls inside the available width and wraps narrow rows', () => {
    const controls = rule('.q-md-code-controls');
    expect(controls).toMatch(/boxSizing:\s*'border-box'/u);
    expect(controls).toMatch(/maxWidth:\s*'100%'/u);
    expect(controls).toMatch(/flexWrap:\s*'wrap'/u);
  });

  it('lets the language selector shrink below its intrinsic width', () => {
    const language = rule('.q-md-code-controls__language');
    expect(language).toMatch(/minWidth:\s*'0'/u);
    expect(language).toMatch(/maxWidth:\s*'min\(11em, 100%\)'/u);
    expect(language).toMatch(/flexShrink:\s*'1'/u);
  });

  it('keeps the copy button from shrinking or wrapping its label', () => {
    const copy = rule('.q-md-code-controls__copy');
    expect(copy).toMatch(/flexShrink:\s*'0'/u);
    expect(copy).toMatch(/whiteSpace:\s*'nowrap'/u);
  });
});
