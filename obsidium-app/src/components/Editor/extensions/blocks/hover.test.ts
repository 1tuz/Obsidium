// @vitest-environment happy-dom
import { EditorState, type Extension, Text } from '@codemirror/state';
import { EditorView, type DecorationSet } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { blockHoverExtension, hoveredBlock, setBlockHover } from './hover';
import type { BlockInfo } from '../../../../modules/blocks/model';

const SOURCE = [
    '---',
    'title: note',
    '---',
    '# Heading',
    '',
    'Paragraph one.',
    '',
    '> quote line',
    '',
    '- list item one',
    '- list item two',
    '',
    '***',
    '',
    'after divider',
].join('\n');
const DOC = Text.of(SOURCE.split('\n'));

function hoverView(extra: Extension = []) {
    const parent = document.createElement('div');
    document.body.append(parent);
    const view = new EditorView({
        state: EditorState.create({
            doc: DOC,
            extensions: [
                blockHoverExtension({ enabled: true, readOnly: true }),
                extra,
            ],
        }),
        parent,
    });
    return { view, parent };
}

function dispatchCountingView(): { view: EditorView; parent: HTMLElement; count: () => number } {
    let dispatched = 0;
    const counter = EditorView.updateListener.of((update) => {
        dispatched += update.transactions.filter((transaction) => transaction.effects.length > 0).length;
    });
    const { view, parent } = hoverView(counter);
    return { view, parent, count: () => dispatched };
}

function blockAtPos(pos: number): BlockInfo {
    const block = hoveredBlock(DOC, pos);
    if (!block) throw new Error(`no block at ${pos}`);
    return block;
}

function blockHoverRanges(view: EditorView): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const sets = view.state.facet(EditorView.decorations) as DecorationSet[];
    for (const set of sets) {
        set.between(0, view.state.doc.length, (start, end, value) => {
            if (value.spec.class === 'q-block-hover') ranges.push([start, end]);
        });
    }
    return ranges;
}

describe('hoveredBlock', () => {
    it('resolves a paragraph', () => {
        const block = hoveredBlock(DOC, SOURCE.indexOf('one'));
        expect(block?.kind).toBe('paragraph');
        expect(block?.from).toBe(SOURCE.indexOf('Paragraph'));
    });

    it('resolves a heading with its level', () => {
        const block = hoveredBlock(DOC, SOURCE.indexOf('Heading') + 2);
        expect(block?.kind).toBe('heading');
        expect(block?.level).toBe(1);
    });

    it('resolves a quote', () => {
        expect(hoveredBlock(DOC, SOURCE.indexOf('quote') + 1)?.kind).toBe('quote');
    });

    it('resolves a list item', () => {
        const block = hoveredBlock(DOC, SOURCE.indexOf('item two') + 2);
        expect(block?.kind).toBe('listItem');
        expect(block?.listKind).toBe('bullet');
    });

    it('returns null on a blank line', () => {
        const blank = SOURCE.indexOf('\n\n') + 1;
        expect(hoveredBlock(DOC, blank)).toBeNull();
    });

    it('ignores frontmatter', () => {
        expect(hoveredBlock(DOC, SOURCE.indexOf('title') + 1)).toBeNull();
        expect(hoveredBlock(DOC, 1)).toBeNull();
    });

    it('resolves an hr block like any other', () => {
        const block = hoveredBlock(DOC, SOURCE.indexOf('***') + 1);
        expect(block?.kind).toBe('hr');
        expect(block?.from).toBe(SOURCE.indexOf('***'));
    });

    it('never paints the hover stripe over a fenced code block', () => {
        const source = [
            'Paragraph one.',
            '',
            '```ts',
            'const value = 1;',
            '```',
            '',
            'Paragraph two.',
        ].join('\n');
        const doc = Text.of(source.split('\n'));
        expect(hoveredBlock(doc, source.indexOf('const value') + 2)).toBeNull();
        expect(hoveredBlock(doc, source.indexOf('```ts') + 2)).toBeNull();
    });

    it('still resolves a paragraph around a code block', () => {
        const source = [
            'Paragraph one.',
            '',
            '```ts',
            'const value = 1;',
            '```',
            '',
            'Paragraph two.',
        ].join('\n');
        const doc = Text.of(source.split('\n'));
        expect(hoveredBlock(doc, source.indexOf('two') + 1)?.kind).toBe('paragraph');
        expect(hoveredBlock(DOC, SOURCE.indexOf('one'))?.kind).toBe('paragraph');
    });
});

describe('setBlockHover', () => {
    it('marks the hovered block range with q-block-hover', () => {
        const { view, parent } = hoverView();
        try {
            const paragraph = blockAtPos(SOURCE.indexOf('Paragraph') + 4);
            setBlockHover(view, paragraph);
            expect(blockHoverRanges(view)).toEqual([[paragraph.from, paragraph.to]]);
        } finally {
            view.destroy();
            parent.remove();
        }
    });

    it('does not dispatch while staying inside the same block', () => {
        const { view, parent, count } = dispatchCountingView();
        try {
            const paragraph = blockAtPos(SOURCE.indexOf('Paragraph') + 4);
            setBlockHover(view, paragraph);
            const afterFirst = count();
            setBlockHover(view, paragraph);
            setBlockHover(view, blockAtPos(SOURCE.indexOf('Paragraph')));
            setBlockHover(view, paragraph);
            expect(count()).toBe(afterFirst);
            setBlockHover(view, blockAtPos(SOURCE.indexOf('Heading')));
            expect(count()).toBe(afterFirst + 1);
        } finally {
            view.destroy();
            parent.remove();
        }
    });

    it('clears the highlight', () => {
        const { view, parent } = hoverView();
        try {
            setBlockHover(view, blockAtPos(SOURCE.indexOf('quote') + 1));
            setBlockHover(view, null);
            expect(blockHoverRanges(view)).toEqual([]);
        } finally {
            view.destroy();
            parent.remove();
        }
    });

    it('ignores frontmatter blocks passed to setBlockHover', () => {
        const { view, parent, count } = dispatchCountingView();
        try {
            const before = count();
            setBlockHover(view, { kind: 'frontmatter' } as BlockInfo);
            expect(count()).toBe(before);
            expect(blockHoverRanges(view)).toEqual([]);
        } finally {
            view.destroy();
            parent.remove();
        }
    });

    it('clears the highlight when the document changes', () => {
        const { view, parent } = hoverView();
        try {
            setBlockHover(view, blockAtPos(SOURCE.indexOf('Paragraph') + 4));
            view.dispatch({ changes: { from: SOURCE.indexOf('one'), to: SOURCE.indexOf('one') + 3, insert: 'two' } });
            expect(blockHoverRanges(view)).toEqual([]);
        } finally {
            view.destroy();
            parent.remove();
        }
    });

    it('re-applies the same range after clearing', () => {
        const { view, parent } = hoverView();
        try {
            const paragraph = blockAtPos(SOURCE.indexOf('Paragraph') + 4);
            setBlockHover(view, paragraph);
            setBlockHover(view, null);
            setBlockHover(view, paragraph);
            expect(blockHoverRanges(view)).toEqual([[paragraph.from, paragraph.to]]);
        } finally {
            view.destroy();
            parent.remove();
        }
    });
});
