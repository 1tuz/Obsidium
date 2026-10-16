import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(process.cwd(), 'src/components/Editor/styles/layout.css'), 'utf8');
const content = readFileSync(resolve(process.cwd(), 'src/components/Editor/EditorContent.tsx'), 'utf8');
const scroll = readFileSync(resolve(process.cwd(), 'src/components/Editor/viewState/scroll.ts'), 'utf8');

describe('Markdown reading scroll', () => {
  it('keeps the reading container as a fallback scrollport', () => {
    expect(content).toContain('className="q-editor-content__body"');
    expect(scroll).toContain("'.q-editor-content--reading .q-editor-content__body .cm-scroller'");
    expect(layout).toMatch(/\.q-editor-container\s*\{[^}]*overflow-y:\s*auto;/u);
    expect(layout).not.toMatch(/\.q-editor-container:has\(\.q-editor-content--reading\)\s*\{[^}]*overflow:\s*hidden;/u);
    expect(layout).toMatch(/\.q-editor-container:not\(\.q-editor-container--book\) \.q-editor-content--reading \.q-editor-content__body \.cm-scroller\s*\{[^}]*overflow-y:\s*auto;/u);
  });
});
