import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layout = readFileSync(resolve(process.cwd(), 'src/components/Editor/styles/layout.css'), 'utf8');
const content = readFileSync(resolve(process.cwd(), 'src/components/Editor/EditorContent.tsx'), 'utf8');
const scroll = readFileSync(resolve(process.cwd(), 'src/components/Editor/viewState/scroll.ts'), 'utf8');

describe('Markdown reading scroll', () => {
  it('keeps the reading container as a fallback scrollport', () => {
    expect(content).toMatch(/className="q-editor-content__body"/u);
    expect(scroll).toContain("'.q-editor-content--reading .q-editor-content__body .cm-scroller'");
    expect(layout).toMatch(/\.q-editor-container\s*\{[^}]*overflow-y:\s*auto;/u);
    expect(layout).not.toMatch(/\.q-editor-container:has\(\.q-editor-content--reading\)\s*\{[^}]*overflow:\s*hidden;/u);
    expect(layout).toMatch(/\.q-editor-container:not\(\.q-editor-container--book\) \.q-editor-content--reading \.q-editor-content__body \.cm-scroller\s*\{[^}]*overflow-y:\s*auto;/u);
  });

  it('gives the reading body CodeMirror host a definite height', () => {
    expect(content).toMatch(/<CodeMirrorView[\s\S]*?className="q-editor-content__cm"[\s\S]*?onCreate=\{handleCreate\}/u);
    expect(layout).toMatch(/\.q-editor-container:not\(\.q-editor-container--book\) \.q-editor-content--reading \.q-editor-content__cm\s*\{[^}]*height:\s*100%;/u);
    expect(layout).toMatch(/\.q-editor-container:not\(\.q-editor-container--book\) \.q-editor-content--reading \.q-editor-content__body \.cm-editor\s*\{[^}]*height:\s*100%;/u);
  });

  it('grows the book editor container so the reading body fills the pane', () => {
    expect(layout).toMatch(
      /\.q-editor-container:not\(\.q-editor-container--book\):has\(\.q-editor-content--reading\) \.q-book-editor-container\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;/u,
    );
  });

  it('keeps the scroll-past-end padding off the reading scroller so it can shrink', () => {
    expect(layout).toMatch(
      /\.q-editor-container:not\(\.q-editor-container--book\) \.q-editor-content--reading \.q-editor-content__body \.cm-scroller\s*\{[^}]*padding-bottom:\s*0;/u,
    );
    expect(layout).toMatch(
      /\.q-editor-container:not\(\.q-editor-container--book\) \.q-editor-content--reading \.q-editor-content__body \.cm-content\s*\{[^}]*padding-bottom:\s*var\(--q-editor-scroll-past-end\);/u,
    );
  });
});
