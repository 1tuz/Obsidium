import { syntaxHighlighting } from '@codemirror/language';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { readFileSnapshot } from '../../../../modules/documents/fileGateway';
import { frontmatterRange } from '../../../../modules/docs/frontmatter';
import {
  noteEmbedCreatesCycle,
  noteEmbedSection,
  type NoteEmbed,
} from '../../../../modules/docs/noteEmbeds';
import { t } from '../../../../i18n';
import { editorMarkdownSupport } from '../markdownConfig';
import { markdownStyles } from '../theme';
import type { LivePreviewConfig } from '../livePreviewConfig';

const embeddedViewByRoot = new WeakMap<HTMLElement, EditorView>();

function noteBody(text: string): string {
  const range = frontmatterRange(text);
  return range ? text.slice(range.to).replace(/^\r?\n/, '') : text;
}

export class NoteTransclusionWidget extends WidgetType {
  constructor(
    private readonly embed: NoteEmbed,
    private readonly config: LivePreviewConfig,
    private readonly revision: number,
    private readonly ancestry: string[],
    private readonly nestedExtension: (path: string, nextAncestry: string[]) => Extension,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof NoteTransclusionWidget
      && this.embed.target === other.embed.target
      && this.embed.heading === other.embed.heading
      && this.config.workspacePath === other.config.workspacePath
      && this.revision === other.revision
      && this.ancestry.length === other.ancestry.length
      && this.ancestry.every((path, index) => path === other.ancestry[index]);
  }

  toDOM(): HTMLElement {
    const root = document.createElement('section');
    root.className = 'q-note-transclusion';
    root.contentEditable = 'false';

    const source = document.createElement('button');
    source.className = 'q-note-transclusion__source';
    source.type = 'button';
    source.textContent = this.embed.target;
    source.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.config.onOpenWikiLink(this.embed.target, 'current');
    });

    const body = document.createElement('div');
    body.className = 'q-note-transclusion__body';
    body.textContent = t('editor.loadingEmbeddedNote');
    root.append(source, body);
    void this.load(root, body);
    return root;
  }

  destroy(dom: HTMLElement): void {
    embeddedViewByRoot.get(dom)?.destroy();
    embeddedViewByRoot.delete(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }

  private async load(root: HTMLElement, body: HTMLElement): Promise<void> {
    try {
      const resolution = await this.config.resolveWikiLinks([this.embed.target]);
      const path = resolution.paths[0];
      if (!path) {
        body.textContent = t('editor.embeddedNoteUnavailable', { target: this.embed.target });
        return;
      }
      if (noteEmbedCreatesCycle(path, this.ancestry)) {
        body.textContent = t('editor.embeddedNoteCycle');
        return;
      }
      const snapshot = await readFileSnapshot(path);
      const content = noteEmbedSection(noteBody(snapshot.content), this.embed.heading);
      if (!content) {
        body.textContent = this.embed.heading
          ? t('editor.embeddedHeadingUnavailable', { heading: this.embed.heading })
          : t('editor.embeddedNoteEmpty');
        return;
      }
      if (!root.isConnected) return;
      body.replaceChildren();
      const view = new EditorView({
        state: EditorState.create({
          doc: content,
          extensions: [
            editorMarkdownSupport,
            syntaxHighlighting(markdownStyles),
            EditorView.editable.of(false),
            EditorView.lineWrapping,
            EditorView.contentAttributes.of({ 'aria-label': this.embed.target, tabindex: '-1' }),
            this.nestedExtension(path, [...this.ancestry, path]),
          ],
        }),
        parent: body,
      });
      embeddedViewByRoot.set(root, view);
    } catch (error) {
      console.error('Failed to load embedded note', error);
      body.textContent = t('editor.embeddedNoteUnavailable', { target: this.embed.target });
    }
  }
}
