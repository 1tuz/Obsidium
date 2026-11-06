import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/Editor/HeadingMinimap.css'), 'utf8');

it('docks the rail against the editor pane instead of the text body', () => {
  expect(css).toMatch(/\.q-block-minimap\s*\{[^}]*position:\s*absolute/u);
  expect(css).toMatch(/\.q-block-minimap\s*\{[^}]*inset-inline-start:\s*var\(--q-space-12\)/u);
  expect(css).toMatch(/\.q-block-minimap\s*\{[^}]*width:\s*var\(--q-minimap-rail\)/u);
});

it('keeps the text column untouchable so both modes share one column', () => {
  expect(css).not.toMatch(/\.q-editor-content__body\s*\{/u);
  expect(css).not.toMatch(/padding-inline-start/u);
});