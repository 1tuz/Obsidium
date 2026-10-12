import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { ensureEditorTree, visibleTreeRanges } from '../ensureEditorTree';
import { codeBlocks } from './blocks';
import { codeBlockControls, codeBlockDecorations } from './decorations';
import { CodeGrammarLoader } from './grammars';
import { codeHighlighting } from './highlight';
import { codeBlockTheme, codeHighlightTheme } from './theme';

const replaceCodeBlockControls = StateEffect.define<DecorationSet>();

const codeBlockControlField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(replaceCodeBlockControls)) next = effect.value;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const codeBlockPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  private readonly grammars = new CodeGrammarLoader();
  private controls: DecorationSet = Decoration.none;
  private controlsDoc: Text | null = null;
  private controlsUpdateQueued = false;
  private destroyed = false;

  constructor(view: EditorView) {
    this.decorations = this.rebuild(view);
    this.scheduleControlsUpdate(view);
  }

  update(update: ViewUpdate): void {
    const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
    if (!update.docChanged && !update.viewportChanged && !treeChanged) return;
    this.decorations = this.rebuild(update.view, update.docChanged || treeChanged);
    this.scheduleControlsUpdate(update.view);
  }

  destroy(): void {
    this.destroyed = true;
    this.grammars.dispose();
  }

  private rebuild(view: EditorView, allowParse = true): DecorationSet {
    const tree = ensureEditorTree(view, allowParse);
    const blocks = codeBlocks(tree, view.state.doc, visibleTreeRanges(view, tree.length));
    this.grammars.sync(view, tree, blocks);
    this.controls = codeBlockControls(blocks);
    return codeBlockDecorations(view.state.doc, blocks);
  }

  private scheduleControlsUpdate(view: EditorView): void {
    this.controlsDoc = view.state.doc;
    if (this.controlsUpdateQueued) return;
    this.controlsUpdateQueued = true;
    queueMicrotask(() => {
      this.controlsUpdateQueued = false;
      if (!this.destroyed && view.state.doc === this.controlsDoc) {
        view.dispatch({ effects: replaceCodeBlockControls.of(this.controls) });
      }
    });
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

export const codeBlockExtension = [codeBlockControlField, codeBlockPlugin, codeHighlighting, codeHighlightTheme, codeBlockTheme];
