import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { Tree } from '@lezer/common';
import { ensureEditorTree, visibleTreeRanges } from '../ensureEditorTree';
import { codeBlocks } from './blocks';
import { codeBlockControls, codeBlockDecorations } from './decorations';
import { CodeGrammarLoader } from './grammars';
import { codeHighlighting } from './highlight';
import { codeBlockTheme, codeHighlightTheme } from './theme';

type VisibleRange = { from: number; to: number };

function sameRanges(a: readonly VisibleRange[] | null, b: readonly VisibleRange[]): boolean {
  if (a === b) return true;
  if (!a || a.length !== b.length) return false;
  return a.every((range, index) => range.from === b[index].from && range.to === b[index].to);
}

const replaceCodeBlockControls = StateEffect.define<DecorationSet>();
const replaceCodeBlockDecorations = StateEffect.define<DecorationSet>();

function decorationField(
  effectType: typeof replaceCodeBlockControls,
  create: () => DecorationSet,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create,
    update(decorations, transaction) {
      let next = decorations.map(transaction.changes);
      for (const effect of transaction.effects) {
        if (effect.is(effectType)) next = effect.value;
      }
      return next;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

const codeBlockControlField = decorationField(replaceCodeBlockControls, () => Decoration.none);
const codeBlockDecorationField = decorationField(replaceCodeBlockDecorations, () => Decoration.none);

const codeBlockPlugin = ViewPlugin.fromClass(class {
  private readonly grammars = new CodeGrammarLoader();
  private decorations: DecorationSet | null = null;
  private controls: DecorationSet | null = null;
  private decorationsDoc: Text | null = null;
  private decorationsHead: number | null = null;
  private decorationsTree: Tree | null = null;
  private decorationsRanges: readonly VisibleRange[] | null = null;
  private controlsDoc: Text | null = null;
  private updateQueued = false;
  private destroyed = false;

  constructor(view: EditorView) {
    this.sync(view);
    this.scheduleUpdate(view);
  }

  update(update: ViewUpdate): void {
    const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
    const editabilityChanged = update.state.facet(EditorView.editable)
      !== update.startState.facet(EditorView.editable);
    if (!update.docChanged && !update.viewportChanged && !treeChanged && !update.selectionSet && !editabilityChanged) return;
    this.sync(update.view, update.docChanged || update.viewportChanged || treeChanged);
    this.scheduleUpdate(update.view);
  }

  destroy(): void {
    this.destroyed = true;
    this.grammars.dispose();
  }

  private sync(view: EditorView, allowParse = true): void {
    const state = view.state;
    const head = state.facet(EditorView.editable) ? state.selection.main.head : null;
    const tree = ensureEditorTree(view, allowParse);
    const ranges = visibleTreeRanges(view, tree.length);
    if (this.decorationsDoc === state.doc
      && this.decorationsHead === head
      && this.decorationsTree === tree
      && sameRanges(this.decorationsRanges, ranges)) return;
    const blocks = codeBlocks(tree, state.doc, ranges);
    this.grammars.sync(view, tree, blocks);
    this.decorations = codeBlockDecorations(state.doc, blocks, head);
    this.controls = codeBlockControls(blocks);
    this.decorationsDoc = state.doc;
    this.decorationsHead = head;
    this.decorationsTree = tree;
    this.decorationsRanges = ranges.map((range) => ({ from: range.from, to: range.to }));
  }

  private scheduleUpdate(view: EditorView): void {
    this.controlsDoc = view.state.doc;
    if (this.updateQueued) return;
    this.updateQueued = true;
    queueMicrotask(() => {
      this.updateQueued = false;
      if (this.destroyed || !this.decorations || !this.controls) return;
      if (view.state.doc !== this.decorationsDoc) return;
      const effects: StateEffect<DecorationSet>[] = [];
      if (view.state.field(codeBlockDecorationField, false) !== this.decorations) {
        effects.push(replaceCodeBlockDecorations.of(this.decorations));
      }
      if (view.state.doc === this.controlsDoc
        && view.state.field(codeBlockControlField, false) !== this.controls) {
        effects.push(replaceCodeBlockControls.of(this.controls));
      }
      if (effects.length === 0) return;
      view.dispatch({ effects });
    });
  }
});

export const codeBlockExtension = [codeBlockDecorationField, codeBlockControlField, codeBlockPlugin, codeHighlighting, codeHighlightTheme, codeBlockTheme];
