// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { editorMarkdownExtensions } from '../markdownConfig';
import { editorFocusExtension, setEditorFocus } from '../editorFocus';
import { collectDiagramDecorations } from './decorations';
import { cachedDiagram, diagramKey, rememberDiagramResult } from './store';
import { diagramThemeKey, diagramThemeVariables } from './theme';

const FLOW = 'flowchart TD\n    A --> B';
const NOTE = ['# Заметка', '', '```mermaid', 'flowchart TD', '  A --> B', '```', '', 'хвост'].join('\n');

const COLOR_LITERAL = /^(?:#[0-9a-f]{3,8}|rgba?\(|hsla?\()/iu;

afterEach(() => {
  document.body.replaceChildren();
  document.head.querySelectorAll('style[data-diagram-test]').forEach((node) => node.remove());
});

function stateOf(doc: string, caret: number, readOnly: boolean) {
  return EditorState.create({
    doc,
    selection: { anchor: caret },
    extensions: [
      markdown({ base: markdownLanguage, addKeymap: false, extensions: editorMarkdownExtensions }),
      editorFocusExtension(),
      ...(readOnly ? [EditorState.readOnly.of(true)] : []),
    ],
  });
}

function warmCache(): void {
  rememberDiagramResult(diagramKey('flowchart TD\n  A --> B', diagramThemeKey()), {
    status: 'ready',
    svg: '<svg viewBox="0 0 10 10"></svg>',
  });
}

describe('diagram theme variables', () => {
  it('never hands Mermaid a keyword instead of a resolved color', () => {
    const variables = diagramThemeVariables();
    for (const [name, value] of Object.entries(variables)) {
      if (name === 'fontFamily' || name === 'fontSize') continue;
      expect(COLOR_LITERAL.test(value), `${name} = ${value}`).toBe(true);
    }
  });

  it('resolves real theme tokens into concrete colors', () => {
    document.documentElement.dataset.theme = 'test-tokens';
    const style = document.createElement('style');
    style.dataset.diagramTest = 'true';
    style.textContent = ':root { --q-bg-accent-subtle: #2d4a6b; --q-text-primary: #e8e4dc; --q-border-accent-subtle: #4a6a8b; --q-bg-surface-raised: #3a3a38; --q-bg-surface-subtle: #2e2e2c; --q-text-secondary: #a8a49c; --q-bg-surface: #262624; --q-border-default: #555555; }';
    document.head.append(style);

    const variables = diagramThemeVariables();
    expect(variables.mainBkg).toBe('#2d4a6b');
    expect(variables.lineColor).toBe('#a8a49c');
    expect(variables.textColor).toBe('#e8e4dc');
  });
});

describe('diagram widget visibility', () => {
  it('keeps the rendered diagram in reading mode when the caret sits inside the fence', () => {
    warmCache();
    const caret = NOTE.indexOf('A --> B');
    const state = stateOf(NOTE, caret, true).update({ effects: setEditorFocus.of(true) }).state;
    expect(collectDiagramDecorations(state)).toHaveLength(1);
  });

  it('still reveals the raw fence while editing with the caret inside it', () => {
    warmCache();
    const caret = NOTE.indexOf('A --> B');
    const state = stateOf(NOTE, caret, false).update({ effects: setEditorFocus.of(true) }).state;
    expect(collectDiagramDecorations(state)).toEqual([]);
  });
});

describe('diagram render result', () => {
  it('reports a ready result for a flowchart when the cache is warm', () => {
    warmCache();
    const result = cachedDiagram(diagramKey('flowchart TD\n  A --> B', diagramThemeKey()));
    expect(result?.status).toBe('ready');
  });
});

describe('diagram source', () => {
  it('keeps the flowchart source in the document', () => {
    expect(FLOW).toContain('flowchart TD');
  });
});
