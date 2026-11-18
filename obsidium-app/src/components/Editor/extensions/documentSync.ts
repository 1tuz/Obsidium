import { collab, getClientID, getSyncedVersion, receiveUpdates, sendableUpdates } from '@codemirror/collab';
import { ChangeSet, type Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
  onDocumentChanged,
  pullChanges,
  pushChanges,
  type LoggedChange,
  type OpenedDocument,
} from '../../../modules/documents/documentGateway';
import { caretAtSameLine } from './caretAtSameLine';
import { revealExternalInsert } from './externalReveal';

interface DocumentSyncOptions {
  path: () => string;
  startVersion: number;
  clientID: string;
  onResync: (document: OpenedDocument) => void;
  onFailure: (error: unknown) => void;
}

interface LiveSync {
  settle(): Promise<void>;
  pushLater(): void;
  needsPush(): boolean;
  broken(): boolean;
}

const EXTERNAL_CLIENTS = new Set(['disk']);
const live = new Set<LiveSync>();

function caretInsideReplacement(changes: ChangeSet, caret: number): boolean {
  let inside = false;
  changes.iterChangedRanges((fromA, toA) => {
    if (toA > fromA && caret > fromA && caret <= toA) inside = true;
  });
  return inside;
}

function applyIncoming(view: EditorView, incoming: LoggedChange[]): void {
  const updates = incoming.map((change) => ({
    changes: ChangeSet.fromJSON(change.changes),
    clientID: change.client,
  }));
  const external = updates.filter((update) => EXTERNAL_CLIENTS.has(update.clientID));
  const caret = view.state.selection.main.head;
  const restoreCaret = view.hasFocus && external.some((update) => caretInsideReplacement(update.changes, caret));
  const before = restoreCaret ? view.state.doc.toString() : '';

  view.dispatch(receiveUpdates(view.state, updates));

  if (restoreCaret) {
    view.dispatch({ selection: { anchor: caretAtSameLine(before, view.state.doc.toString(), caret) } });
  }
  for (const update of external) {
    update.changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
      if (fromA === toA) revealExternalInsert(view, { from: fromB, to: fromB, insert: inserted.toString() });
    });
  }
}

export async function flushSyncedEditors(): Promise<boolean> {
  const editors = [...live];
  editors.forEach((editor) => editor.pushLater());
  await Promise.all(editors.map((editor) => editor.settle()));
  return editors.every((editor) => !editor.broken() && !editor.needsPush());
}

export function documentSync(options: DocumentSyncOptions): Extension {
  class SyncPlugin implements LiveSync {
    private inFlight: Promise<void> | null = null;
    private pullAgain = false;
    private failure: unknown = null;
    private done = false;
    private readonly unlisten: () => void;

    constructor(private readonly view: EditorView) {
      live.add(this);
      this.unlisten = onDocumentChanged(options.path, () => {
        if (this.inFlight) this.pullAgain = true;
        this.pushLater();
      });
      this.pushLater();
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) this.pushLater();
    }

    settle(): Promise<void> {
      return this.inFlight ?? Promise.resolve();
    }

    needsPush(): boolean {
      return !this.done && sendableUpdates(this.view.state).length > 0;
    }

    broken(): boolean {
      return this.failure !== null;
    }

    pushLater(): void {
      if (this.inFlight || this.done) return;
      this.inFlight = this.sync().finally(() => {
        this.inFlight = null;
      });
    }

    private async sync(): Promise<void> {
      try {
        while (!this.done) {
          if (!(await this.pull())) return;
          const updates = sendableUpdates(this.view.state);
          if (updates.length === 0) return;
          const accepted = await pushChanges(
            options.path(),
            getSyncedVersion(this.view.state),
            getClientID(this.view.state),
            updates.map((update) => update.changes.toJSON()),
          );
          this.failure = null;
          if (!accepted) continue;
        }
      } catch (error) {
        this.failure = error;
        options.onFailure(error);
      }
    }

    private async pull(): Promise<boolean> {
      do {
        this.pullAgain = false;
        const result = await pullChanges(options.path(), getSyncedVersion(this.view.state));
        if (this.done) return false;
        this.failure = null;
        if (result.kind === 'resync') {
          options.onResync({ text: result.text, version: result.version });
          return false;
        }
        if (result.changes.length > 0) applyIncoming(this.view, result.changes);
      } while (this.pullAgain && !this.done);
      return true;
    }

    destroy(): void {
      this.done = true;
      live.delete(this);
      this.unlisten();
    }
  }

  const plugin = ViewPlugin.fromClass(SyncPlugin);
  return [collab({ startVersion: options.startVersion, clientID: options.clientID }), plugin];
}
