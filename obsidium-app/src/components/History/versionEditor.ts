import { acceptChunk, getChunks, getOriginalDoc, rejectChunk, unifiedMergeView } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { drawSelection, EditorView } from '@codemirror/view';
import { t } from '../../i18n';
import type { VersionTexts } from '../../modules/history';
import { revertChunkText, type VersionChunk } from '../../modules/history/chunk';
import { obsidiumCodeMirrorTheme } from '../Common/codeMirror';

const DIFF_TIMEOUT_MS = 300;

export interface VersionEditorActions {
  onRevertChunk: (chunk: VersionChunk) => void;
}

export interface VersionEditor {
  view: EditorView;
  chunkRevertAt(pos: number): VersionChunk | null;
  markReverted(chunk: VersionChunk): boolean;
  acceptChunkAt(pos: number): boolean;
  destroy(): void;
}

export function createVersionEditor(
  parent: HTMLElement,
  texts: VersionTexts,
  actions: VersionEditorActions,
): VersionEditor {
  let editor: EditorView | null = null;

  const chunkAt = (pos: number) => {
    const found = editor ? getChunks(editor.state) : null;
    return found?.chunks.find((chunk) => chunk.fromB <= pos && chunk.endB >= pos) ?? null;
  };

  const chunkRevertAt = (pos: number): VersionChunk | null => {
    if (!editor) return null;
    const chunk = chunkAt(pos);
    if (!chunk) return null;
    const versionText = editor.state.doc.toString();
    const previousText = getOriginalDoc(editor.state).toString();
    const from = chunk.fromB;
    const to = Math.min(versionText.length, chunk.toB);
    const revertedText = revertChunkText(versionText, previousText, {
      previous: { from: chunk.fromA, to: chunk.toA },
      version: { from, to: chunk.toB },
    });
    if (revertedText === versionText) return null;
    return { from, to, versionText, revertedText };
  };

  const button = (type: 'reject' | 'accept') => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = `q-history-chunk-button q-history-chunk-button--${type}`;
    element.textContent = t(type === 'reject' ? 'history.chunkRevert' : 'history.chunkKeep');
    element.title = t(type === 'reject' ? 'history.chunkRevertTitle' : 'history.chunkKeepTitle');
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
      const widget = element.closest('.cm-deletedChunk');
      if (!widget || !editor) return;
      const pos = editor.posAtDOM(widget);
      if (type === 'reject') {
        const chunk = chunkRevertAt(pos);
        if (chunk) actions.onRevertChunk(chunk);
      } else {
        acceptChunk(editor, pos);
      }
    });
    return element;
  };

  const changes = texts.previous === null
    ? []
    : unifiedMergeView({
      original: texts.previous,
      mergeControls: (type) => button(type),
      gutter: false,
      syntaxHighlightDeletions: false,
      diffConfig: { timeout: DIFF_TIMEOUT_MS },
    });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: texts.text,
      extensions: [
        obsidiumCodeMirrorTheme,
        drawSelection(),
        EditorView.lineWrapping,
        EditorState.readOnly.of(true),
        changes,
      ],
    }),
  });
  editor = view;

  return {
    view,
    chunkRevertAt,
    markReverted(chunk) {
      return rejectChunk(view, chunk.from);
    },
    acceptChunkAt(pos) {
      return acceptChunk(view, pos);
    },
    destroy() {
      editor = null;
      view.destroy();
    },
  };
}
