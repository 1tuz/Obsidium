import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/components/Editor/HeadingMinimap.css'), 'utf8');

it('reserves the minimap rail and text gap once, with an editing handle band on top', () => {
  expect(css).toMatch(/\.q-editor-content__body--minimap\s*\{[^}]*--q-minimap-rail:\s*var\(--q-space-32\)/u);
  expect(css).toMatch(/\.q-editor-content__body--minimap\s*\{[^}]*--q-minimap-gap:\s*var\(--q-space-12\)/u);
  expect(css).toMatch(/\.q-editor-content__body--minimap\s*\{[^}]*padding-inline-start:\s*calc\(var\(--q-minimap-rail\)\s*\+\s*var\(--q-minimap-gap\)\)/u);
  expect(css).toMatch(/\.q-editor-content__body--minimap-editing\s*\{[^}]*padding-inline-start:\s*calc\(var\(--q-minimap-rail\)\s*\+\s*var\(--q-minimap-gap\)\s*\+\s*var\(--q-space-24\)\)/u);
});

it('sizes the dock from its rows instead of stretching it over the viewport', () => {
  expect(css).toMatch(/\.q-block-minimap\s*\{[^}]*width:\s*var\(--q-minimap-rail\)/u);
  expect(css).not.toMatch(/\.q-block-minimap\s*\{[^}]*height:\s*100%/u);
});

it('animates the dock magnification and renders the hover label chip', () => {
  expect(css).toMatch(/\.q-block-minimap__stroke\s*\{[^}]*transition:[^}]*width\s+90ms/u);
  expect(css).toMatch(/\.q-block-minimap__label\s*\{[^}]*inset-inline-start:\s*100%/u);
  expect(css).toMatch(/\.q-block-minimap__label\s*\{[^}]*pointer-events:\s*none/u);
  expect(css).toMatch(/\.q-block-minimap__label\s*\{[^}]*background:\s*var\(--q-bg-surface-raised\)/u);
});
