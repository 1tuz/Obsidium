import type { EditorView } from '@codemirror/view';
import { cancelScheduledTableWrites } from './structure';
import type { TableModel } from './model';
import { findTablesInDoc, serializeTable } from './constructs';
import { localChange, textChange } from '../../../../modules/docs/noteEmbedEditing';

export interface TableWidgetHandle {
    from: number;
    contentTo: number;
    blockTo: number;
}

interface WidgetSessionHost {
    dispose(): void;
    snapshotForReadOnly(): { from: number; model: TableModel } | null;
    syncHandle(handle: TableWidgetHandle): void;
    syncModel(model: TableModel): void;
}

const sessions = new WeakMap<HTMLElement, WidgetSessionHost>();

export function bindWidgetSession(root: HTMLElement, session: WidgetSessionHost): void {
    sessions.set(root, session);
}

export function unbindWidgetSession(dom: HTMLElement): void {
    sessions.get(dom)?.dispose();
    sessions.delete(dom);
}

export function syncWidgetSession(
    dom: HTMLElement,
    handle: TableWidgetHandle,
    model?: TableModel,
): boolean {
    const session = sessions.get(dom);
    if (!session) return false;
    session.syncHandle(handle);
    if (model) session.syncModel(model);
    return true;
}

export function cellRefFromElement(
    root: HTMLElement,
    target: EventTarget | null,
): { row: number; col: number } | null {
    if (!(target instanceof HTMLElement)) return null;
    const cell = target.closest('td') as HTMLTableCellElement | null;
    if (!cell || !root.contains(cell)) return null;
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
    return { row, col };
}

export function flushTableWidgetSessions(view: EditorView): void {
    cancelScheduledTableWrites(view);
    const roots = [...view.dom.querySelectorAll<HTMLElement>('.q-md-table-widget')];
    const snapshots = roots.map((root) => sessions.get(root)?.snapshotForReadOnly()).filter((item) => item != null);
    const tables = findTablesInDoc(view.state.doc);
    const changes = snapshots.flatMap((snapshot) => {
        const table = tables.find((item) => item.from === snapshot.from);
        if (!table) return [];
        const change = textChange(view.state.doc.sliceString(table.from, table.contentTo), serializeTable(snapshot.model));
        return change ? [localChange(change, { from: table.from, to: table.contentTo }, view.state.doc)] : [];
    });
    if (changes.length && !view.state.readOnly) view.dispatch({ changes, userEvent: 'input' });
}
