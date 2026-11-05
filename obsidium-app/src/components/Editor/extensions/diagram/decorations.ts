import type { EditorState, Range } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import { collectPreviewReplaceDecorations } from '../livePreviewEditableSpans';
import { findDiagramBlocks } from './constructs';
import { cachedDiagram, diagramKey } from './store';
import { diagramThemeKey } from './theme';
import { DiagramWidget } from './widget';

export function collectDiagramDecorations(state: EditorState): Range<Decoration>[] {
  const themeKey = diagramThemeKey();
  const blocks = findDiagramBlocks(state);
  if (blocks.length === 0) return [];
  return collectPreviewReplaceDecorations(
    state,
    blocks,
    (block) => {
      const cacheKey = diagramKey(block.source, themeKey);
      return new DiagramWidget({ from: block.from, cacheKey, result: cachedDiagram(cacheKey) });
    },
  );
}
