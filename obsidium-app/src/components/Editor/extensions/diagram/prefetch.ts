import { StateEffect, type Extension } from '@codemirror/state';
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import { PrefetchScheduler } from '../prefetchScheduler';
import { DIAGRAM_PREFETCH_DELAYS } from './constants';
import { findDiagramBlocks } from './constructs';
import { renderDiagram } from './render';
import { cachedDiagram, diagramKey, forgetDiagramsOutside } from './store';
import { diagramThemeKey } from './theme';

export const diagramDataReady = StateEffect.define<null>();

const THEME_ATTRIBUTES = ['data-theme', 'data-palette', 'data-accent-mode', 'data-appearance', 'style'];

class DiagramPrefetcher {
  private readonly scheduler: PrefetchScheduler;
  private readonly themeObserver: MutationObserver;
  private themeKey: string;

  constructor(private readonly view: EditorView) {
    this.themeKey = diagramThemeKey();
    this.scheduler = new PrefetchScheduler(
      view,
      DIAGRAM_PREFETCH_DELAYS,
      () => this.refreshDiagrams(),
    );
    this.themeObserver = new MutationObserver(() => {
      const themeKey = diagramThemeKey();
      if (themeKey === this.themeKey) return;
      this.themeKey = themeKey;
      this.scheduler.schedule(true);
    });
    this.themeObserver.observe(document.documentElement, { attributeFilter: THEME_ATTRIBUTES });
  }

  update(update: ViewUpdate): void {
    const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
    if (update.docChanged || treeChanged) this.scheduler.schedule(false);
  }

  destroy(): void {
    this.themeObserver.disconnect();
    this.scheduler.destroy();
  }

  private async refreshDiagrams(): Promise<void> {
    if (this.scheduler.destroyed) return;
    const state = this.view.state;
    const blocks = findDiagramBlocks(state);
    if (blocks.length === 0) return;

    const themeKey = diagramThemeKey();
    const keys = new Set(blocks.map((block) => diagramKey(block.source, themeKey)));
    if (syntaxTreeAvailable(state, state.doc.length)) forgetDiagramsOutside(keys);

    const pending = new Set<string>();
    for (const block of blocks) {
      if (!cachedDiagram(diagramKey(block.source, themeKey))) pending.add(block.source);
    }
    if (pending.size === 0) return;

    const results = await Promise.all([...pending].map((source) => renderDiagram(source)));
    if (this.scheduler.destroyed) return;
    if (results.some(Boolean)) this.view.dispatch({ effects: diagramDataReady.of(null) });
  }
}

export function diagramPrefetchExtension(): Extension {
  return ViewPlugin.fromClass(DiagramPrefetcher);
}