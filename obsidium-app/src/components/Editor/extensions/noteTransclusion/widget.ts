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

interface EmbedResources {
  view?: EditorView;
  observer?: IntersectionObserver;
  abort: AbortController;
  unregister?: () => void;
}

const resourcesByRoot = new WeakMap<HTMLElement, EmbedResources>();

function noteBody(text: string): string {
  const range = frontmatterRange(text);
  return range ? text.slice(range.to).replace(/^\r?\n/, '') : text;
}

export class NoteTransclusionWidget extends WidgetType {
  constructor(
    private readonly embed: NoteEmbed,
    private readonly config: LivePreviewConfig,
    private readonly targetKey: string,
    private readonly revision: number,
    private readonly ancestry: string[],
    private readonly nestedExtension: (path: string, nextAncestry: string[]) => Extension,
    private readonly registerTarget: (target: string, path: string) => () => void,
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
    const resources: EmbedResources = { abort: new AbortController() };
    resourcesByRoot.set(root, resources);
    source.className = 'q-note-transclusion__source';
    source.type = 'button';
    source.textContent = this.embed.target;
    source.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.config.onOpenWikiLink(this.embed.target, 'current');
    }, { signal: resources.abort.signal });

    const body = document.createElement('div');
    body.className = 'q-note-transclusion__body';
    body.textContent = t('editor.loadingEmbeddedNote');
    root.append(source, body);
    if (typeof IntersectionObserver === 'undefined') {
      void this.load(root, body, resources);
    } else {
      resources.observer = new IntersectionObserver((entries) => {
        if (!entries.some(({ isIntersecting }) => isIntersecting)) return;
        resources.observer?.disconnect();
        resources.observer = undefined;
        void this.load(root, body, resources);
      }, { rootMargin: '400px' });
      resources.observer.observe(root);
    }
    return root;
  }

  destroy(dom: HTMLElement): void {
    const resources = resourcesByRoot.get(dom);
    resources?.observer?.disconnect();
    resources?.abort.abort();
    resources?.unregister?.();
    resources?.view?.destroy();
    resourcesByRoot.delete(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }

  private async load(root: HTMLElement, body: HTMLElement, resources: EmbedResources): Promise<void> {
    try {
      const resolution = await this.config.resolveWikiLinks([this.embed.target]);
      if (resources.abort.signal.aborted || !root.isConnected) return;
      const path = resolution.paths[0];
      if (!path) {
        body.textContent = t('editor.embeddedNoteUnavailable', { target: this.embed.target });
        return;
      }
      if (noteEmbedCreatesCycle(path, this.ancestry)) {
        body.textContent = t('editor.embeddedNoteCycle');
        return;
      }
      resources.unregister = this.registerTarget(this.targetKey, path);
      const snapshot = await readFileSnapshot(path);
      if (resources.abort.signal.aborted || !root.isConnected) return;
      const content = noteEmbedSection(noteBody(snapshot.content), this.embed.heading);
      if (!content) {
        body.textContent = this.embed.heading
          ? t('editor.embeddedHeadingUnavailable', { heading: this.embed.heading })
          : t('editor.embeddedNoteEmpty');
        return;
      }
      body.replaceChildren();
      resources.view = new EditorView({
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
    } catch (error) {
      if (resources.abort.signal.aborted) return;
      console.error('Failed to load embedded note', error);
      body.textContent = t('editor.embeddedNoteUnavailable', { target: this.embed.target });
    }
  }
}
