import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { syntaxHighlighting } from '@codemirror/language';
import {
  Compartment,
  EditorState,
  Prec,
  Transaction,
  type ChangeSet,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { t } from '../../../../i18n';
import { textChange } from '../../../../modules/docs/noteEmbedEditing';
import {
  NoteEmbedSession,
  type NoteEmbedBlockReason,
  type NoteEmbedReplica,
} from '../../../../modules/docs/noteEmbedSession';
import {
  onDocumentChanged,
  openDocument,
  pullChanges,
  pushChanges,
  readDocument,
  releaseDocument,
} from '../../../../modules/documents/documentGateway';
import { editorMarkdownSupport } from '../markdownConfig';
import { markdownStyles } from '../theme';

const replica: NoteEmbedReplica = {
  open: openDocument,
  read: readDocument,
  release: releaseDocument,
  push: pushChanges,
  pull: pullChanges,
  onChange: (path, handler) => onDocumentChanged(() => path, handler),
};

const editableCompartment = new Compartment();

interface EmbedEditingOptions {
  parentView: EditorView;
  root: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
  view: EditorView;
  path: string;
  heading: string | null;
  clientId: string;
}

export function noteEmbedEditorExtensions(
  controller: () => EmbedEditingController | null,
  label: string,
): Extension[] {
  return [
    editorMarkdownSupport,
    syntaxHighlighting(markdownStyles),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': label, tabindex: '-1' }),
    editableCompartment.of([EditorState.readOnly.of(true), EditorView.editable.of(false)]),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    Prec.highest(keymap.of([
      {
        key: 'Escape',
        run: () => {
          controller()?.deactivate();
          return true;
        },
      },
    ])),
    Prec.highest(EditorView.domEventHandlers({
      keydown(event) {
        event.stopPropagation();
        return false;
      },
    })),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) controller()?.applyLocal(update.changes);
    }),
  ];
}

export class EmbedEditingController {
  private session: NoteEmbedSession | null = null;
  private outside: ((event: PointerEvent) => void) | null = null;
  private activating = false;
  private blocked = false;
  private destroyed = false;
  private editable = false;
  private applyingText = false;

  constructor(private readonly options: EmbedEditingOptions) {}

  async activate(position?: { clientX?: number; clientY?: number }): Promise<void> {
    if (this.activating || this.session || this.destroyed) return;
    if (this.options.parentView.state.readOnly) return;
    this.activating = true;
    this.blocked = false;
    const session = new NoteEmbedSession({
      path: this.options.path,
      heading: this.options.heading,
      clientId: this.options.clientId,
      replica,
      onText: (text) => this.onText(text),
      onBlocked: (reason) => this.onBlocked(reason),
    });
    let started = false;
    try {
      await session.start();
      started = true;
    } catch (error) {
      console.error('Failed to edit embedded note', error);
      this.onBlocked('missing-note');
    }
    this.activating = false;
    if (!started || this.blocked || this.destroyed) {
      session.destroy();
      return;
    }
    this.session = session;
    this.setEditable(true);
    this.options.root.classList.add('q-note-transclusion--editing');
    this.options.status.textContent = '';
    this.options.body.title = t('editor.embeddedEditHint');
    this.outside = (event) => {
      const target = event.target;
      if (target instanceof Node && this.options.root.contains(target)) return;
      this.deactivate();
    };
    document.addEventListener('pointerdown', this.outside);
    const { clientX, clientY } = position ?? {};
    const { view } = this.options;
    const anchor = clientX === undefined || clientY === undefined
      ? view.state.doc.length
      : view.posAtCoords({ x: clientX, y: clientY }) ?? view.state.doc.length;
    view.dispatch({ selection: { anchor } });
    view.focus();
  }

  applyLocal(changes: ChangeSet): void {
    if (this.applyingText || this.destroyed) return;
    this.session?.applyLocal(changes);
    this.options.parentView.requestMeasure();
  }

  deactivate(): void {
    if (this.activating) this.blocked = true;
    if (this.outside) {
      document.removeEventListener('pointerdown', this.outside);
      this.outside = null;
    }
    const session = this.session;
    this.session = null;
    this.setEditable(false);
    session?.destroy();
    this.options.root.classList.remove('q-note-transclusion--editing');
    this.options.body.title = '';
  }

  destroy(): void {
    if (this.destroyed) return;
    this.deactivate();
    this.destroyed = true;
  }

  private setEditable(value: boolean): void {
    if (this.editable === value) return;
    this.editable = value;
    this.options.view.dispatch({
      effects: editableCompartment.reconfigure([
        EditorState.readOnly.of(!value),
        EditorView.editable.of(value),
      ]),
    });
  }

  private onText(text: string): void {
    if (this.blocked || this.destroyed) return;
    const { view } = this.options;
    const change = textChange(view.state.doc.toString(), text);
    if (!change) return;
    this.applyingText = true;
    view.dispatch({ changes: change, annotations: Transaction.addToHistory.of(false) });
    this.applyingText = false;
    this.options.parentView.requestMeasure();
  }

  private onBlocked(reason: NoteEmbedBlockReason): void {
    this.blocked = true;
    const target = this.options.path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') ?? this.options.path;
    this.options.status.textContent = reason === 'missing-note'
      ? t('editor.embeddedNoteUnavailable', { target })
      : reason === 'missing-heading'
        ? t('editor.embeddedHeadingUnavailable', { heading: this.options.heading ?? '' })
        : t('editor.embeddedRangeChanged');
    this.deactivate();
  }
}
