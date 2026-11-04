// @vitest-environment happy-dom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { filterSlashItems, slashMenuExtension, SLASH_ITEMS, type SlashItem } from './slash';

const ITEMS: SlashItem[] = [
    { id: 'text', label: 'Text', category: 'basic', target: 'paragraph', insert: '' },
    { id: 'heading1', label: 'Heading 1', category: 'headings', target: 'heading1', insert: '# ' },
    { id: 'heading2', label: 'Heading 2', category: 'headings', target: 'heading2', insert: '## ' },
    { id: 'heading3', label: 'Heading 3', category: 'headings', target: 'heading3', insert: '### ' },
    { id: 'bullet', label: 'Bullet list', category: 'lists', target: 'bullet', insert: '- ' },
    { id: 'ordered', label: 'Numbered list', category: 'lists', target: 'ordered', insert: '1. ' },
    { id: 'task', label: 'To-do list', category: 'lists', target: 'task', insert: '- [ ] ' },
    { id: 'quote', label: 'Quote', category: 'advanced', target: 'quote', insert: '> ' },
    { id: 'code', label: 'Code block', category: 'advanced', target: 'code', insert: '```\n\n```' },
    { id: 'toggle', label: 'Toggle', category: 'advanced', insert: '> [!note]- Toggle' },
    { id: 'table', label: 'Table', category: 'advanced' },
    { id: 'divider', label: 'Divider', category: 'advanced', insert: '---' },
];

describe('filterSlashItems', () => {
    it('returns every item for an empty query', () => {
        expect(filterSlashItems('', ITEMS)).toEqual(ITEMS);
        expect(filterSlashItems('   ', ITEMS)).toEqual(ITEMS);
    });

    it('matches case-insensitive substrings of labels', () => {
        expect(filterSlashItems('head', ITEMS).map((item) => item.id)).toEqual([
            'heading1',
            'heading2',
            'heading3',
        ]);
        expect(filterSlashItems('TO-DO', ITEMS).map((item) => item.id)).toEqual(['task']);
        expect(filterSlashItems('quo', ITEMS).map((item) => item.id)).toEqual(['quote']);
    });

    it('matches item ids case-insensitively', () => {
        expect(filterSlashItems('HEADING2', ITEMS).map((item) => item.id)).toEqual(['heading2']);
    });

    it('matches category labels', () => {
        const advanced = filterSlashItems('advanced', ITEMS).map((item) => item.id);
        expect(advanced).toEqual(['quote', 'code', 'toggle', 'table', 'divider']);
        expect(filterSlashItems('LISTS', ITEMS).map((item) => item.id)).toEqual([
            'bullet',
            'ordered',
            'task',
        ]);
    });

    it('returns an empty list when nothing matches', () => {
        expect(filterSlashItems('zzzz', ITEMS)).toEqual([]);
        expect(filterSlashItems('/ /', ITEMS)).toEqual([]);
    });
});

describe('SLASH_ITEMS', () => {
    it('exposes every block kind with unique ids', () => {
        const ids = SLASH_ITEMS.map((item) => item.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).toContain('table');
        expect(ids).toContain('divider');
        expect(ids).toContain('toggle');
    });
});

describe('slashMenuExtension', () => {
    it('contributes no extensions when disabled or read-only', () => {
        expect(slashMenuExtension({ enabled: false, readOnly: false })).toEqual([]);
        expect(slashMenuExtension({ enabled: true, readOnly: true })).toEqual([]);
        expect(Array.isArray(slashMenuExtension({ enabled: true, readOnly: false }))).toBe(true);
    });

    it('opens the panel when a slash starts an empty line', () => {
        const parent = document.createElement('div');
        document.body.append(parent);
        const view = new EditorView({
            state: EditorState.create({
                doc: 'body',
                extensions: [slashMenuExtension({ enabled: true, readOnly: false })],
            }),
            parent,
        });
        view.focus();
        view.dispatch({ changes: { from: 4, insert: '\n/' }, selection: { anchor: 6 } });
        expect(document.querySelectorAll('.q-block-slash').length).toBe(1);
        expect(document.querySelectorAll('.q-block-slash__row').length).toBeGreaterThan(0);
        view.destroy();
        parent.remove();
    });

    it('removes the panel when the view is destroyed', () => {
        const parent = document.createElement('div');
        document.body.append(parent);
        const view = new EditorView({
            state: EditorState.create({
                doc: '/',
                extensions: [slashMenuExtension({ enabled: true, readOnly: false })],
            }),
            parent,
        });
        view.destroy();
        expect(document.querySelectorAll('.q-block-slash').length).toBe(0);
        parent.remove();
    });
});
