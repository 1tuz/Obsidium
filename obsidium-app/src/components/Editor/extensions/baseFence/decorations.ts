import { type EditorState, type Range } from '@codemirror/state';
import { Decoration } from '@codemirror/view';
import type { LivePreviewConfig } from '../livePreviewConfig';
import { collectPreviewReplaceDecorations } from '../livePreviewEditableSpans';
import { findBaseFences } from './constructs';
import { resolveBaseFencePath } from './run';
import { baseFenceCacheNoteKey, baseFenceKey, baseFenceRevision } from './store';
import { BaseFenceWidget } from './widget';

export function collectBaseFenceDecorations(
  state: EditorState,
  config: LivePreviewConfig | null,
): Range<Decoration>[] {
  if (!config?.workspacePath) return [];
  const workspacePath = config.workspacePath;
  const cacheNotePath = baseFenceCacheNoteKey(workspacePath, config.notePath());
  const revision = baseFenceRevision(workspacePath);
  const fences = findBaseFences(state).flatMap((fence) => {
    const basePath = resolveBaseFencePath(workspacePath, fence.path);
    return basePath ? [{ from: fence.from, to: fence.to, basePath, view: fence.view }] : [];
  });

  return collectPreviewReplaceDecorations(
    state,
    fences,
    (fence) => new BaseFenceWidget({
      basePath: fence.basePath,
      view: fence.view,
      cacheNotePath,
      cacheKey: baseFenceKey(fence.basePath, fence.view),
      revision,
      workspacePath,
    }),
  );
}
