// @vitest-environment happy-dom
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tablesExtension } from './index';
import { flushTableWidgetSessions } from './widgetSessionRegistry';
import { scheduleApplyTableModel, scheduleDeleteTable } from './structure';
import { findTablesInDoc } from './constructs';
import { setCell } from './model';

const markdown = '| A | B |\n| --- | --- |\n| old | value |\n';
const views: EditorView[] = [];
afterEach(() => {
    views.forEach((view) => { view.destroy(); view.dom.remove(); });
    views.length = 0;
    vi.useRealTimers();
});

function setup(readOnly = false) {
    const mode = new Compartment();
    let changes = 0;
    const spans: { from: number; to: number; insert: string }[] = [];
    const view = new EditorView({ parent: document.body,
        state: EditorState.create({ doc: markdown, extensions: [tablesExtension,
            mode.of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
            EditorView.updateListener.of((update) => {
                if (!update.docChanged) return;
                changes += 1;
                update.changes.iterChanges((from, to, _fromB, _toB, insert) => {
                    spans.push({ from, to, insert: insert.toString() });
                });
            }),
        ] }),
    });
    views.push(view);
    return { view, spans, changes: () => changes, setMode: (value: boolean) => view.dispatch({
        effects: mode.reconfigure([EditorState.readOnly.of(value), EditorView.editable.of(!value)]),
    }) };
}

function activate(view: EditorView) {
    const cell = view.dom.querySelector<HTMLElement>('td[data-row="1"][data-col="0"]')!;
    cell.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    const field = view.dom.querySelector<HTMLElement>('td .cm-editor')!;
    expect(field).not.toBeNull();
    return EditorView.findFromDOM(field)!;
}

function flush(view: EditorView) {
    flushTableWidgetSessions(view);
}

describe('table reading mode', () => {
    it.each([false, true])('renders without a nested editor in reading mode, initially %s', (initial) => {
        const { view, setMode } = setup(initial);
        setMode(true);
        expect(view.dom.querySelector('.q-md-table-widget--readonly')).not.toBeNull();
        expect(view.dom.querySelector('.q-md-table-cell-field, .q-md-table-widget .cm-editor')).toBeNull();
        view.dom.querySelector('td')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(view.dom.querySelector('.q-md-table-cell-field, .q-md-table-widget .cm-editor')).toBeNull();
        expect(view.dom.querySelector('.q-md-table-add-row, .q-md-table-col-strip-btn')).toBeNull();
        setMode(false);
        activate(view);
    });

    it('commits the active nested editor synchronously once before reading mode', async () => {
        vi.useFakeTimers();
        const { view, spans, setMode, changes } = setup();
        const nested = activate(view);
        nested.dispatch({ changes: { from: 0, to: nested.state.doc.length, insert: 'updated' } });
        flush(view);
        expect(view.state.readOnly).toBe(false);
        expect(view.state.doc.toString()).toContain('| updated | value |');
        const cellFrom = markdown.indexOf('old');
        expect(spans).toEqual([{ from: cellFrom, to: cellFrom + 2, insert: 'update' }]);
        expect(changes()).toBe(1);
        setMode(true);
        expect(view.dom.querySelector('.q-md-table-cell-field, .q-md-table-widget .cm-editor')).toBeNull();
        await vi.advanceTimersByTimeAsync(500);
        expect(changes()).toBe(1);
    });

    it.each(['😁', String.fromCodePoint(0x1f200)])('replaces an emoji with complete scalar boundaries for %s', async (replacement) => {
        vi.useFakeTimers();
        const { view, spans, changes, setMode } = setup();
        const cellFrom = markdown.indexOf('old');
        view.dispatch({ changes: { from: cellFrom, to: cellFrom + 3, insert: '😀' } });
        const nested = activate(view);
        nested.dispatch({ changes: { from: 0, to: nested.state.doc.length, insert: replacement } });
        spans.length = 0;
        flush(view);
        expect(spans).toEqual([{ from: cellFrom, to: cellFrom + 2, insert: replacement }]);
        expect(view.state.doc.toString()).toContain(`| ${replacement} | value |`);
        setMode(true);
        await vi.advanceTimersByTimeAsync(500);
        expect(changes()).toBe(2);
    });

    it('handles a disappeared nested editor without a later source change', async () => {
        vi.useFakeTimers();
        const { view, setMode, changes } = setup();
        activate(view).dom.remove();
        flush(view);
        setMode(true);
        await vi.advanceTimersByTimeAsync(500);
        expect(view.state.doc.toString()).toBe(markdown);
        expect(changes()).toBe(0);
    });
    it('commits an already-issued add-row action before reading and cancels its queued callback', async () => {
        vi.useFakeTimers();
        const { view, setMode, changes } = setup();
        view.dom.querySelector('.q-md-table-add-row')!.dispatchEvent(new MouseEvent('mousedown', {
            bubbles: true, button: 0, clientX: 100, clientY: 100,
        }));
        expect(view.dom.querySelectorAll('tbody tr')).toHaveLength(3);
        expect(findTablesInDoc(view.state.doc)[0].model.cells).toHaveLength(2);
        expect(changes()).toBe(0);
        flush(view);
        expect(view.state.readOnly).toBe(false);
        expect(findTablesInDoc(view.state.doc)[0].model.cells).toHaveLength(3);
        expect(changes()).toBe(1);
        setMode(true);
        const committed = view.state.doc.toString();
        await vi.advanceTimersByTimeAsync(500);
        expect(view.state.doc.toString()).toBe(committed);
        expect(changes()).toBe(1);
        expect(view.dom.querySelector('.q-md-table-widget .cm-editor')).toBeNull();
    });

    it.each(['apply', 'delete'])('invalidates queued %s even when editing resumes immediately', async (operation) => {
        const { view, setMode, changes } = setup();
        const table = findTablesInDoc(view.state.doc)[0];
        if (operation === 'apply') {
            scheduleApplyTableModel(view, table.from, table.contentTo, setCell(table.model, 0, 0, 'stale'));
        }
        else scheduleDeleteTable(view, table.from, table.to);
        flush(view);
        setMode(true);
        setMode(false);
        await new Promise<void>((resolve) => queueMicrotask(resolve));
        expect(view.state.doc.toString()).toBe(markdown);
        expect(changes()).toBe(0);
    });

});
