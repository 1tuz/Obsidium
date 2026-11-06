// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { editorMarkdownExtensions } from '../markdownConfig';
import { editorFocusExtension, setEditorFocus } from '../editorFocus';
import { findDiagramBlocks } from './constructs';
import { collectDiagramDecorations } from './decorations';
import { createDiagramDom } from './dom';
import { cachedDiagram, diagramKey, forgetDiagramsOutside, rememberDiagramResult } from './store';
import { diagramThemeKey } from './theme';
import { DiagramWidget } from './widget';

const FLOW = ['# Заметка', '', '```mermaid', 'flowchart TD', '  A --> B', '```', '', 'хвост'].join('\n');

function stateOf(doc: string, caret?: number) {
  return EditorState.create({
    doc,
    selection: caret === undefined ? undefined : { anchor: caret },
    extensions: [
      markdown({ base: markdownLanguage, addKeymap: false, extensions: editorMarkdownExtensions }),
      editorFocusExtension(),
    ],
  });
}

describe('diagram fences', () => {
  it('finds mermaid fences with their source and ignores other languages', () => {
    const doc = ['```mermaid', 'flowchart TD', '  A --> B', '```', '', '```js', 'const a = 1;', '```'].join('\n');
    const blocks = findDiagramBlocks(stateOf(doc));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.from).toBe(0);
    expect(blocks[0]!.to).toBe(doc.indexOf('```\n\n```js') + 3);
    expect(blocks[0]!.source).toBe('flowchart TD\n  A --> B');
  });

  it('ignores an empty mermaid fence so the raw block stays editable', () => {
    expect(findDiagramBlocks(stateOf('```mermaid\n```'))).toEqual([]);
  });

  it('accepts an uppercase language tag', () => {
    expect(findDiagramBlocks(stateOf('```Mermaid\nflowchart TD\n```'))).toHaveLength(1);
  });
});

describe('diagram decorations', () => {
  it('replaces the fence with a widget when the caret is outside and the cache is warm', () => {
    const state = stateOf(`${FLOW}\n\nконец`, FLOW.length + 2);
    const key = diagramKey('flowchart TD\n  A --> B', diagramThemeKey());
    rememberDiagramResult(key, { status: 'ready', svg: '<svg viewBox="0 0 10 10"></svg>' });
    const decorations = collectDiagramDecorations(state);
    expect(decorations).toHaveLength(1);
    const fenceStart = FLOW.indexOf('```mermaid');
    const fenceEnd = FLOW.indexOf('```', FLOW.indexOf('flowchart')) + 3;
    expect(decorations[0]!.from).toBe(fenceStart);
    expect(decorations[0]!.to).toBe(fenceEnd);
    expect(decorations[0]!.value.spec.widget).toBeInstanceOf(DiagramWidget);
  });

  it('shows the raw fence while the caret is inside it', () => {
    const caret = FLOW.indexOf('A --> B');
    const state = stateOf(FLOW, caret).update({ effects: setEditorFocus.of(true) }).state;
    expect(collectDiagramDecorations(state)).toEqual([]);
  });

  it('renders again when focus leaves an open diagram', () => {
    const caret = FLOW.indexOf('A --> B');
    const state = stateOf(FLOW, caret);
    expect(collectDiagramDecorations(state)).toHaveLength(1);
  });
});

describe('diagram widget dom', () => {
  it('announces a pending render', () => {
    const dom = createDiagramDom(undefined);
    expect(dom.querySelector('.q-md-diagram-frame--pending')).not.toBeNull();
    expect(dom.textContent).not.toBe('');
  });

  it('reports the parser message when rendering failed', () => {
    const dom = createDiagramDom({ status: 'failed', message: 'Parse error on line 2' });
    expect(dom.querySelector('.q-md-diagram-frame--failed')?.textContent).toContain('Parse error on line 2');
  });

  it('embeds the rendered svg', () => {
    const dom = createDiagramDom({ status: 'ready', svg: '<svg viewBox="0 0 12 8"><g/></svg>' });
    const svg = dom.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class')).toContain('q-md-diagram-svg');
  });

  it('falls back to a failure frame when the svg is malformed', () => {
    const dom = createDiagramDom({ status: 'ready', svg: '<html><body>nope</body></html>' });
    expect(dom.querySelector('.q-md-diagram-frame--failed')).not.toBeNull();
  });
});

describe('diagram cache', () => {
  it('keys a diagram by its source and theme', () => {
    expect(diagramKey('flowchart TD', 'light')).not.toBe(diagramKey('flowchart TD', 'dark'));
    expect(diagramKey('flowchart TD', 'light')).toBe(diagramKey('flowchart TD', 'light'));
  });

  it('reports only real changes as ready work', () => {
    const key = diagramKey('flowchart TD\n  A --> B', 'light');
    expect(rememberDiagramResult(key, { status: 'ready', svg: '<svg/>' })).toBe(true);
    expect(rememberDiagramResult(key, { status: 'ready', svg: '<svg/>' })).toBe(false);
    expect(cachedDiagram(key)).toEqual({ status: 'ready', svg: '<svg/>' });
  });

  it('drops cached diagrams the document no longer holds', () => {
    const kept = diagramKey('flowchart TD', 'light');
    const dropped = diagramKey('sequenceDiagram', 'light');
    rememberDiagramResult(kept, { status: 'ready', svg: '<svg/>' });
    rememberDiagramResult(dropped, { status: 'ready', svg: '<svg/>' });
    forgetDiagramsOutside(new Set([kept]));
    expect(cachedDiagram(kept)).toBeDefined();
    expect(cachedDiagram(dropped)).toBeUndefined();
  });
});
