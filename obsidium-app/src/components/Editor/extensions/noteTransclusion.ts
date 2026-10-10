import { syntaxTree } from '@codemirror/language';
import { EditorState, StateEffect, StateField, type Extension, type Range, type Transaction } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import { listen } from '@tauri-apps/api/event';
import { frontmatterRange } from '../../../modules/docs/frontmatter';
import { parseNoteEmbed } from '../../../modules/docs/noteEmbeds';
import { isMarkdownPath } from '../../../modules/documents/fileGateway';
import { isInsidePath, samePath } from '../../../modules/paths';
import { hasAncestorNamed } from './syntaxAncestor';
import { livePreviewConfigFacet, type LivePreviewConfig } from './livePreviewConfig';
import { NoteTransclusionWidget } from './noteTransclusion/widget';
import { shouldRevealSyntax } from './livePreviewVisibility';

const refreshNoteEmbeds = StateEffect.define<string[]>();

interface TransclusionRegistry {
  views: Set<EditorView>;
  targets: Map<string, Map<string, number>>;
  registerTarget: (target: string, path: string) => () => void;
  refreshPaths: (paths: string[]) => void;
}

function createRegistry(): TransclusionRegistry {
  const registry: TransclusionRegistry = {
    views: new Set(),
    targets: new Map(),
    registerTarget(target, path) {
      const targets = registry.targets.get(path) ?? new Map<string, number>();
      targets.set(target, (targets.get(target) ?? 0) + 1);
      registry.targets.set(path, targets);
      return () => {
        const count = targets.get(target) ?? 0;
        if (count <= 1) targets.delete(target);
        else targets.set(target, count - 1);
        if (targets.size === 0) registry.targets.delete(path);
      };
    },
    refreshPaths(paths) {
      const targets = new Set(paths.flatMap((path) => [...registry.targets]
        .filter(([usedPath]) => samePath(path, usedPath))
        .flatMap(([, usedTargets]) => [...usedTargets.keys()])));
      if (targets.size === 0) return;
      for (const view of registry.views) view.dispatch({ effects: refreshNoteEmbeds.of([...targets]) });
    },
  };
  return registry;
}

function collectNoteEmbedDecorations(
  state: EditorState,
  revisions: Map<string, number>,
  ancestry: string[],
  nestedExtension: (path: string, nextAncestry: string[]) => Extension,
  registerTarget: TransclusionRegistry['registerTarget'],
): Range<Decoration>[] {
  const config = state.facet(livePreviewConfigFacet);
  if (!config?.workspacePath) return [];
  const frontmatter = frontmatterRange(state.doc.sliceString(0, Math.min(1500, state.doc.length)));
  const ranges: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);
    if (frontmatter && line.from < frontmatter.to && line.to >= frontmatter.from) continue;
    if (hasAncestorNamed(tree.resolveInner(line.from, 1), 'FencedCode')) continue;
    ranges.push(...collectLineDecoration(
      state, line.from, revisions, ancestry, nestedExtension, registerTarget,
    ));
  }
  return ranges;
}

function collectLineDecoration(
  state: EditorState,
  lineFrom: number,
  revisions: Map<string, number>,
  ancestry: string[],
  nestedExtension: (path: string, nextAncestry: string[]) => Extension,
  registerTarget: TransclusionRegistry['registerTarget'],
): Range<Decoration>[] {
  const config = state.facet(livePreviewConfigFacet);
  if (!config?.workspacePath) return [];
  const line = state.doc.lineAt(lineFrom);
  const frontmatter = frontmatterRange(state.doc.sliceString(0, Math.min(1500, state.doc.length)));
  if (frontmatter && line.from < frontmatter.to && line.to >= frontmatter.from) return [];
  if (hasAncestorNamed(syntaxTree(state).resolveInner(line.from, 1), 'FencedCode')) return [];
  const embed = parseNoteEmbed(line.text);
  if (!embed || shouldRevealSyntax(state.doc, state.selection.main.head, line.from, line.to)) return [];
  const targetKey = `${config.notePath()}\0${embed.target}`;
  return [Decoration.replace({
    widget: new NoteTransclusionWidget(
      embed,
      config,
      targetKey,
      revisions.get(targetKey) ?? 0,
      ancestry,
      nestedExtension,
      registerTarget,
    ),
    block: true,
  }).range(line.from, line.to)];
}

const refreshField = StateField.define<Map<string, number>>({
  create: () => new Map(),
  update(value, transaction) {
    const targets = transaction.effects
      .filter((effect) => effect.is(refreshNoteEmbeds))
      .flatMap((effect) => effect.value);
    if (targets.length === 0) return value;
    const next = new Map(value);
    for (const target of targets) next.set(target, (next.get(target) ?? 0) + 1);
    return next;
  },
});

export function noteTransclusionExtension(
  config: LivePreviewConfig,
  ancestry: string[] = [config.notePath()],
  listenForChanges = true,
  registry = createRegistry(),
) {
  const nestedExtension = (path: string, nextAncestry: string[]): Extension[] => {
    const nestedConfig = { ...config, notePath: () => path };
    return [
      livePreviewConfigFacet.of(nestedConfig),
      ...noteTransclusionExtension(nestedConfig, nextAncestry, false, registry),
    ];
  };
  const decorationsField = StateField.define<DecorationSet>({
    create: (state) => Decoration.set(
      collectNoteEmbedDecorations(
        state, state.field(refreshField), ancestry, nestedExtension, registry.registerTarget,
      ),
      true,
    ),
    update(value, transaction) {
      const refreshed = transaction.effects.some((effect) => effect.is(refreshNoteEmbeds));
      if (transaction.docChanged || refreshed) {
        return Decoration.set(
          collectNoteEmbedDecorations(
            transaction.state,
            transaction.state.field(refreshField),
            ancestry,
            nestedExtension,
            registry.registerTarget,
          ),
          true,
        );
      }
      const mapped = transaction.changes.empty ? value : value.map(transaction.changes);
      if (!transaction.selection || transaction.selection.eq(transaction.startState.selection)) return mapped;
      return updateSelectionLines(mapped, transaction, ancestry, nestedExtension, registry.registerTarget);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  const workspaceEvents = ViewPlugin.fromClass(class {
    private disposed = false;
    private unlisten: (() => void) | null = null;

    constructor(private readonly view: EditorView) {
      registry.views.add(view);
      if (!listenForChanges) return;
      void listen<string[]>('workspace-changed', ({ payload }) => {
        if (this.disposed || !config.workspacePath || !payload.some((path) =>
          isMarkdownPath(path) && isInsidePath(path, config.workspacePath!),
        )) return;
        registry.refreshPaths(payload.filter((path) => isMarkdownPath(path)));
      }).then((unlisten) => {
        if (this.disposed) unlisten();
        else this.unlisten = unlisten;
      }).catch((error) => console.error('Failed to subscribe to note embed changes', error));
    }

    destroy() {
      this.disposed = true;
      registry.views.delete(this.view);
      this.unlisten?.();
    }
  });

  return [refreshField, decorationsField, workspaceEvents];
}

function updateSelectionLines(
  decorations: DecorationSet,
  transaction: Transaction,
  ancestry: string[],
  nestedExtension: (path: string, nextAncestry: string[]) => Extension,
  registerTarget: TransclusionRegistry['registerTarget'],
): DecorationSet {
  const revisions = transaction.state.field(refreshField);
  const lines = new Set([
    transaction.startState.doc.lineAt(transaction.startState.selection.main.head).from,
    transaction.state.doc.lineAt(transaction.state.selection.main.head).from,
  ]);
  let next = decorations;
  for (const lineFrom of lines) {
    const line = transaction.state.doc.lineAt(lineFrom);
    next = next.update({
      filterFrom: line.from,
      filterTo: line.to,
      filter: () => false,
      add: collectLineDecoration(
        transaction.state, line.from, revisions, ancestry, nestedExtension, registerTarget,
      ),
      sort: true,
    });
  }
  return next;
}
