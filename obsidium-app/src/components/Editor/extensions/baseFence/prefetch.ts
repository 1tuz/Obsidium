import { StateEffect, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { livePreviewConfigFacet } from '../livePreviewConfig';
import { PrefetchScheduler } from '../prefetchScheduler';
import { BASE_FENCE_PREFETCH_DELAYS } from './constants';
import { findBaseFences } from './constructs';
import { evaluateBaseFence, resolveBaseFencePath } from './run';
import {
  baseFenceCacheNoteKey,
  baseFenceKey,
  baseFenceRevision,
  bumpBaseFenceRevision,
  cachedBaseFenceResult,
  forgetBaseFencesOutside,
} from './store';

export const baseFenceDataReady = StateEffect.define<null>();

class BaseFencePrefetcher {
  private readonly scheduler: PrefetchScheduler;
  private workspacePath: string | null;

  constructor(private readonly view: EditorView) {
    this.scheduler = new PrefetchScheduler(
      view,
      BASE_FENCE_PREFETCH_DELAYS,
      (refresh) => this.refreshFences(refresh),
    );
    this.workspacePath = view.state.facet(livePreviewConfigFacet)?.workspacePath ?? null;
  }

  update(update: ViewUpdate): void {
    const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
    const workspacePath = update.state.facet(livePreviewConfigFacet)?.workspacePath ?? null;
    const workspaceChanged = workspacePath !== this.workspacePath;
    this.workspacePath = workspacePath;
    if (update.docChanged || treeChanged || workspaceChanged) this.scheduler.schedule(workspaceChanged);
  }

  destroy(): void {
    this.scheduler.destroy();
  }

  private async refreshFences(refresh: boolean): Promise<void> {
    const config = this.view.state.facet(livePreviewConfigFacet);
    const workspacePath = config?.workspacePath;
    if (this.scheduler.destroyed || !config || !workspacePath) return;

    const revision = refresh ? bumpBaseFenceRevision(workspacePath) : baseFenceRevision(workspacePath);
    const cacheNotePath = baseFenceCacheNoteKey(workspacePath, config.notePath());
    const fences = new Map<string, { basePath: string; view: string | null }>();
    for (const fence of findBaseFences(this.view.state)) {
      const basePath = resolveBaseFencePath(workspacePath, fence.path);
      if (basePath) fences.set(baseFenceKey(basePath, fence.view), { basePath, view: fence.view });
    }

    if (syntaxTreeAvailable(this.view.state, this.view.state.doc.length)) {
      forgetBaseFencesOutside(cacheNotePath, new Set(fences.keys()));
    }
    if (fences.size === 0) return;

    const pending = [...fences.entries()].filter(([key]) =>
      refresh || !cachedBaseFenceResult(cacheNotePath, key, revision),
    );
    if (pending.length === 0) return;

    const results = await Promise.all(pending.map(([, fence]) => evaluateBaseFence(
      workspacePath,
      cacheNotePath,
      revision,
      fence.basePath,
      fence.view,
    )));
    if (this.scheduler.destroyed) return;
    if (results.some(Boolean)) this.view.dispatch({ effects: baseFenceDataReady.of(null) });
  }
}

export function baseFencePrefetchExtension(): Extension {
  return ViewPlugin.fromClass(BaseFencePrefetcher);
}
