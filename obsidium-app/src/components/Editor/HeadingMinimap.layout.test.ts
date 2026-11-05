import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

it('reserves separate gutters for minimap marks and editing handles', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/components/Editor/HeadingMinimap.css'), 'utf8');
  expect(css).toMatch(/\.q-editor-content__body--minimap\s*\{[^}]*padding-inline-start:\s*var\(--q-space-28\)/u);
  expect(css).toMatch(/\.q-editor-content__body--minimap-editing\s*\{[^}]*padding-inline-start:\s*calc\(var\(--q-space-28\)\s*\+\s*var\(--q-space-24\)\)/u);
});
