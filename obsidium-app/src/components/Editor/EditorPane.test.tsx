// @vitest-environment happy-dom
import type { ComponentProps } from 'preact';
import { useEffect } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tablesExtension } from './extensions/tables';
import { act } from 'preact/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { mountDom, type MountedDom } from '../../testing/mountDom';
import { EditorPane } from './EditorPane';

const fixture = vi.hoisted(() => ({ view: null as EditorView | null, mode: null as Compartment | null }));
vi.mock('./index', () => ({ Editor: ({ readOnly, onBodyViewChange }: { readOnly: boolean; onBodyViewChange(view: EditorView | null): void }) => {
    useEffect(() => { onBodyViewChange(fixture.view); }, [onBodyViewChange]);
    useEffect(() => {
        if (fixture.view && fixture.mode) fixture.view.dispatch({ effects: fixture.mode.reconfigure([
            EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
        ]) });
    }, [readOnly]);
    return <div data-editor-readonly={String(readOnly)} />;
} }));
vi.mock('../../modules/history', () => ({ useOpenedVersion: () => null, closeVersion: vi.fn() }));
vi.mock('../../modules/settings', () => ({ useSettingsStore: () => ({ config: null }), DEFAULT_BUILTINS: { editingToolbar: false } }));
vi.mock('../History/HistoryView', () => ({ HistoryView: () => null }));
vi.mock('./EditingToolbar', () => ({ EditingToolbar: () => null }));
vi.mock('./PageSearchBar', () => ({ PageSearchBar: () => null }));
vi.mock('../../modules/export', () => ({ exportNoteToPdf: vi.fn() }));

let renderer: MountedDom | null = null;
afterEach(() => {
    act(() => renderer?.unmount()); renderer = null;
    fixture.view?.destroy(); fixture.view?.dom.remove(); fixture.view = null; fixture.mode = null;
});
const noop = () => {};
const props: ComponentProps<typeof EditorPane> = {
    canGoBack: false, canGoForward: false, onNavigate: noop,
    tab: { tabId: 'tab-1', path: 'First.md', documentId: 'doc-1', kind: 'document', paneId: 'pane-1' },
    paneId: 'pane-1', inactive: false, focused: true, remountNonce: '', workspacePath: null,
    ensureLinksReady: async () => {}, linkRevision: 0, loadedView: () => null,
    isViewLoaded: () => true, viewRevision: 0, stateError: null,
    onViewStateChange: noop, onOpenWikiLink: noop, onOpenExternalUrl: noop,
    focusMode: false, onToggleFocusMode: noop,
};

it('preserves reading mode across navigation in the same tab and resets for another tab', () => {
    act(() => { renderer = mountDom(<EditorPane {...props} />); });
    const readOnly = () => renderer!.container.querySelector('[data-editor-readonly]')!.getAttribute('data-editor-readonly');
    expect(readOnly()).toBe('false');
    act(() => renderer!.container.querySelector<HTMLButtonElement>('[aria-pressed]')!.click());
    expect(readOnly()).toBe('true');
    act(() => renderer!.update(<EditorPane {...props} tab={{ ...props.tab, path: 'Next.md' }} />));
    expect(readOnly()).toBe('true');
    act(() => renderer!.update(<EditorPane {...props} tab={{ ...props.tab, tabId: 'tab-2', path: 'Next.md' }} />));
    expect(readOnly()).toBe('false');
});

it('flushes the active table cell before the editor receives reading mode', async () => {
    fixture.mode = new Compartment();
    let changes = 0;
    const view = new EditorView({ parent: document.body, state: EditorState.create({
        doc: '| A | B |\n| --- | --- |\n| old | value |\n',
        extensions: [tablesExtension, fixture.mode.of([]), EditorView.updateListener.of((update) => {
            if (update.docChanged) changes += 1;
        })],
    }) });
    fixture.view = view;
    act(() => { renderer = mountDom(<EditorPane {...props} />); });
    view.dom.querySelector('td[data-row="1"]')!.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: 0, clientX: 100, clientY: 100,
    }));
    const nested = EditorView.findFromDOM(view.dom.querySelector<HTMLElement>('td .cm-editor')!)!;
    nested.dispatch({ changes: { from: 0, to: nested.state.doc.length, insert: 'saved' } });
    act(() => renderer!.container.querySelector<HTMLButtonElement>('[aria-pressed]')!.click());
    expect(view.state.readOnly).toBe(true);
    expect(view.state.doc.toString()).toContain('| saved | value |');
    expect(view.dom.querySelector('.q-md-table-widget .cm-editor')).toBeNull();
    expect(changes).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(changes).toBe(1);
});
