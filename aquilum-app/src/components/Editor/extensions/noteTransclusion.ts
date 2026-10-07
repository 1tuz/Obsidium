import { syntaxTree } from '@codemirror/language';
import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin } from '@codemirror/view';
import { listen } from '@tauri-apps/api/event';
import { frontmatterRange } from '../../../modules/docs/frontmatter';
import { parseNoteEmbed } from '../../../modules/docs/noteEmbeds';
import { isMarkdownPath } from '../../../modules/documents/fileGateway';
import { isInsidePath } from '../../../modules/paths';
import { hasAncestorNamed } from './syntaxAncestor';
import { livePreviewConfigFacet, type LivePreviewConfig } from './livePreviewConfig';
import { NoteTransclusionWidget } from './noteTransclusion/widget';
import { shouldRevealSyntax } from './livePreviewVisibility';

const refreshNoteEmbeds = StateEffect.define<void>();

function collectNoteEmbedDecorations(
  state: EditorState,
  revision: number,
  ancestry: string[],
  nestedExtension: (path: string, nextAncestry: string[]) => Extension,
): Range<Decoration>[] {
  const config = state.facet(livePreviewConfigFacet);
  if (!config?.workspacePath) return [];
  const frontmatter = frontmatterRange(state.doc.sliceString(0, Math.min(1500, state.doc.length)));
  const ranges: Range<Decoration>[] = [];
  const head = state.selection.main.head;
  const tree = syntaxTree(state);

  for (let lineNo = 1; lineNo <= state.doc.lines; lineNo += 1) {
    const line = state.doc.line(lineNo);
    if (frontmatter && line.from < frontmatter.to && line.to >= frontmatter.from) continue;
    if (hasAncestorNamed(tree.resolveInner(line.from, 1), 'FencedCode')) continue;
    const embed = parseNoteEmbed(line.text);
    if (!embed || shouldRevealSyntax(state.doc, head, line.from, line.to)) continue;
    ranges.push(Decoration.replace({
      widget: new NoteTransclusionWidget(embed, config, revision, ancestry, nestedExtension),
      block: true,
    }).range(line.from, line.to));
  }
  return ranges;
}

const refreshField = StateField.define<number>({
  create: () => 0,
  update(value, transaction) {
    return value + Number(transaction.effects.some((effect) => effect.is(refreshNoteEmbeds)));
  },
});

export function noteTransclusionExtension(
  config: LivePreviewConfig,
  ancestry: string[] = [config.notePath()],
  listenForChanges = true,
) {
  const nestedExtension = (path: string, nextAncestry: string[]): Extension[] => {
    const nestedConfig = { ...config, notePath: () => path };
    return [
      livePreviewConfigFacet.of(nestedConfig),
      ...noteTransclusionExtension(nestedConfig, nextAncestry, false),
    ];
  };
  const decorationsField = StateField.define<DecorationSet>({
    create: (state) => Decoration.set(
      collectNoteEmbedDecorations(state, state.field(refreshField), ancestry, nestedExtension),
      true,
    ),
    update(value, transaction) {
      if (
        transaction.docChanged
        || transaction.selection
        || transaction.effects.some((effect) => effect.is(refreshNoteEmbeds))
      ) {
        return Decoration.set(
          collectNoteEmbedDecorations(
            transaction.state,
            transaction.state.field(refreshField),
            ancestry,
            nestedExtension,
          ),
          true,
        );
      }
      return value.map(transaction.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });

  if (!listenForChanges) return [refreshField, decorationsField];

  const workspaceEvents = ViewPlugin.fromClass(class {
    private disposed = false;
    private unlisten: (() => void) | null = null;

    constructor(private readonly view: EditorView) {
      void listen<string[]>('workspace-changed', ({ payload }) => {
        if (this.disposed || !config.workspacePath || !payload.some((path) =>
          isMarkdownPath(path) && isInsidePath(path, config.workspacePath!),
        )) return;
        this.view.dispatch({ effects: refreshNoteEmbeds.of() });
      }).then((unlisten) => {
        if (this.disposed) unlisten();
        else this.unlisten = unlisten;
      }).catch((error) => console.error('Failed to subscribe to note embed changes', error));
    }

    destroy() {
      this.disposed = true;
      this.unlisten?.();
    }
  });

  return [refreshField, decorationsField, workspaceEvents];
}
