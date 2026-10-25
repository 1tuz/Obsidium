import { syntaxHighlighting } from '@codemirror/language';
import { EditorState, Text, type Extension } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { editorMarkdownSupport } from '../markdownConfig';
import { markdownStyles } from '../theme';
import { readFileSnapshot } from '../../../../modules/documents/fileGateway';
import { frontmatterRange } from '../../../../modules/docs/frontmatter';
import { noteEmbedBodyRange } from '../../../../modules/docs/noteEmbedEditing';
import {
  noteEmbedCreatesCycle,
  noteEmbedSection,
  type NoteEmbed,
} from '../../../../modules/docs/noteEmbeds';
import { t } from '../../../../i18n';
import { EmbedEditingController, noteEmbedEditorExtensions } from './editing';
import type { LivePreviewConfig } from '../livePreviewConfig';

interface EmbedResources {
  view?: EditorView;
  controller?: EmbedEditingController;
  observer?: IntersectionObserver;
  abort: AbortController;
  unregister?: () => void;
}

const resourcesByRoot = new WeakMap<HTMLElement, EmbedResources>();

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
      && this.embed.blockId === other.embed.blockId
      && this.config.workspacePath === other.config.workspacePath
      && this.revision === other.revision
      && this.ancestry.length === other.ancestry.length
      && this.ancestry.every((path, index) => path === other.ancestry[index]);
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('section');
    root.className = 'q-note-transclusion';
    root.contentEditable = 'false';
    const resources: EmbedResources = { abort: new AbortController() };
    resourcesByRoot.set(root, resources);
    const source = document.createElement('button');
    source.className = 'q-note-transclusion__source';
    source.type = 'button';
    source.textContent = this.embed.target;
    if (this.embed.heading) {
      const heading = document.createElement('span');
      heading.className = 'q-note-transclusion__heading';
      heading.textContent = `› ${this.embed.heading}`;
      source.append(heading);
    }
    source.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.config.onOpenWikiLink(this.embed.target, 'current');
    }, { signal: resources.abort.signal });
    const body = document.createElement('div');
    body.className = 'q-note-transclusion__body';
    body.textContent = t('editor.loadingEmbeddedNote');
    const status = document.createElement('p');
    status.className = 'q-note-transclusion__status';
    status.setAttribute('role', 'status');
    root.append(source, body, status);
    if (typeof IntersectionObserver === 'undefined') {
      void this.load(view, root, body, status, resources);
    } else {
      resources.observer = new IntersectionObserver((entries) => {
        if (!entries.some(({ isIntersecting }) => isIntersecting)) return;
        resources.observer?.disconnect();
        resources.observer = undefined;
        void this.load(view, root, body, status, resources);
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
    resources?.controller?.destroy();
    resources?.view?.destroy();
    resourcesByRoot.delete(dom);
  }

  ignoreEvent(): boolean {
    return true;
  }

  private renderBlock(
    body: HTMLElement, path: string, note: string, blockId: string, resources: EmbedResources,
  ): void {
    const block = noteEmbedSection(note, null, blockId);
    if (!block) {
      body.textContent = t('editor.embeddedBlockUnavailable', { blockId });
      return;
    }
    body.replaceChildren();
    resources.view = new EditorView({
      state: EditorState.create({
        doc: block,
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
  }

  private async load(
    parentView: EditorView, root: HTMLElement, body: HTMLElement, status: HTMLElement,
    resources: EmbedResources,
  ): Promise<void> {
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
      const frontmatter = frontmatterRange(snapshot.content);
      const note = (frontmatter ? snapshot.content.slice(frontmatter.to).replace(/^\r?\n/, '') : snapshot.content)
        .replace(/\r\n?/g, '\n');
      if (this.embed.blockId) {
        this.renderBlock(body, path, note, this.embed.blockId, resources);
        return;
      }
      const text = Text.of(note.split('\n'));
      const range = noteEmbedBodyRange(text, this.embed.heading);
      if (!range) {
        body.textContent = t('editor.embeddedHeadingUnavailable', { heading: this.embed.heading ?? '' });
        return;
      }
      const content = text.sliceString(range.from, range.to);
      body.replaceChildren();
      const view = new EditorView({
        state: EditorState.create({
          doc: content,
          extensions: [
            noteEmbedEditorExtensions(() => resources.controller ?? null, this.embed.target),
            this.nestedExtension(path, [...this.ancestry, path]),
          ],
        }),
        parent: body,
      });
      resources.view = view;
      resources.controller = new EmbedEditingController({
        parentView,
        root,
        body,
        status,
        view,
        path,
        heading: this.embed.heading,
        clientId: crypto.randomUUID(),
      });
      body.addEventListener('click', (event) => {
        event.stopPropagation();
        void resources.controller?.activate({ clientX: event.clientX, clientY: event.clientY });
      });
      if (!content.trim()) status.textContent = t('editor.embeddedNoteEmpty');
    } catch (error) {
      if (resources.abort.signal.aborted) return;
      console.error('Failed to load embedded note', error);
      body.textContent = t('editor.embeddedNoteUnavailable', { target: this.embed.target });
    }
  }
}
