import { StateEffect, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { markOpenStage } from '../../../../modules/perf/openTrace';
import { livePreviewConfigFacet } from '../livePreviewConfig';
import { PrefetchScheduler } from '../prefetchScheduler';
import { DATAVIEW_PREFETCH_DELAYS } from './constants';
import { findDataviewBlocks } from './constructs';
import { evaluateDataviewQuery } from './run';
import { cachedDataviewResult, dataviewCacheNoteKey, forgetDataviewQueriesOutside } from './store';

export const dataviewDataReady = StateEffect.define<null>();

type BlockTick = {
  workspacePath: string;
  notePath: string;
  timer: ReturnType<typeof setTimeout> | null;
};

class DataviewPrefetcher {
  private readonly scheduler: PrefetchScheduler;
  private readonly ticks = new Map<string, BlockTick>();
  private workspacePath: string | null;

  constructor(private readonly view: EditorView) {
    this.scheduler = new PrefetchScheduler(view, DATAVIEW_PREFETCH_DELAYS, (refresh) => this.refreshBlocks(refresh));
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
    for (const tick of this.ticks.values()) {
      if (tick.timer !== null) clearTimeout(tick.timer);
    }
    this.ticks.clear();
  }

  private async refreshBlocks(refresh: boolean): Promise<void> {
    const config = this.view.state.facet(livePreviewConfigFacet);
    const workspacePath = config?.workspacePath;
    if (this.scheduler.destroyed || !config || !workspacePath) return;

    const notePath = config.notePath();
    const cacheNotePath = dataviewCacheNoteKey(workspacePath, notePath);
    const queries = [...new Set(
      findDataviewBlocks(this.view.state)
        .map((block) => block.query)
        .filter((query) => query.length > 0),
    )];

    if (syntaxTreeAvailable(this.view.state, this.view.state.doc.length)) {
      forgetDataviewQueriesOutside(cacheNotePath, new Set(queries));
      this.dropTicksOutside(workspacePath, notePath, queries);
    }
    if (queries.length === 0) return;

    const pendingQueries = queries.filter((query) => refresh || !cachedDataviewResult(cacheNotePath, query));
    let changed = false;
    if (pendingQueries.length > 0) {
      const results = await Promise.all(
        pendingQueries.map((query) => evaluateDataviewQuery(workspacePath, notePath, query)),
      );
      changed = results.some(Boolean);
    }
    if (this.scheduler.destroyed) return;
    if (changed) this.view.dispatch({ effects: dataviewDataReady.of(null) });
    for (const query of queries) this.armTick(query, notePath, workspacePath);
    markOpenStage('dataview');
  }

  private armTick(query: string, notePath: string, workspacePath: string): void {
    if (this.scheduler.destroyed) return;
    const known = this.ticks.get(query);
    if (known?.workspacePath === workspacePath && known.notePath === notePath && known.timer !== null) return;

    const result = cachedDataviewResult(dataviewCacheNoteKey(workspacePath, notePath), query);
    const seconds = result?.status === 'ready' ? result.output.refreshSeconds : null;
    if (!seconds) return;

    const tick: BlockTick = { workspacePath, notePath, timer: null };
    tick.timer = setTimeout(() => {
      tick.timer = null;
      this.scheduler.enqueue(() => this.tick(query, notePath, workspacePath));
    }, seconds * 1000);
    this.ticks.set(query, tick);
  }

  private async tick(query: string, notePath: string, workspacePath: string): Promise<void> {
    if (this.scheduler.destroyed) return;
    const changed = await evaluateDataviewQuery(workspacePath, notePath, query);
    if (this.scheduler.destroyed) return;
    if (changed) this.view.dispatch({ effects: dataviewDataReady.of(null) });
    this.armTick(query, notePath, workspacePath);
  }

  private dropTicksOutside(workspacePath: string, notePath: string, queries: readonly string[]): void {
    const kept = new Set(queries);
    for (const [query, tick] of this.ticks) {
      if (tick.workspacePath === workspacePath && tick.notePath === notePath && kept.has(query)) continue;
      if (tick.timer !== null) clearTimeout(tick.timer);
      this.ticks.delete(query);
    }
  }
}

export function dataviewPrefetchExtension(): Extension {
  return ViewPlugin.fromClass(DataviewPrefetcher);
}
