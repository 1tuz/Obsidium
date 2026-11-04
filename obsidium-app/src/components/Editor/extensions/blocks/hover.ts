import { StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view';
import { findBlockAt, scanDocument, type BlockInfo, type BlockRange } from '../../../../modules/blocks/model';
import './hover.css';

const HOVER_EFFECT = StateEffect.define<BlockRange | null>();
const hoverDecoration = Decoration.mark({ class: 'q-block-hover' });

export function hoveredBlock(doc: Text, pos: number): BlockInfo | null {
    const block = findBlockAt(scanDocument(doc), pos);
    return block && block.kind !== 'frontmatter' ? block : null;
}

const hoverField = StateField.define<BlockRange | null>({
    create: () => null,
    update(value, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(HOVER_EFFECT)) return effect.value;
        }
        if (transaction.docChanged) return null;
        return value;
    },
    provide: (field) => EditorView.decorations.compute([field, 'doc'], (state) => {
        const range = state.field(field);
        if (!range || range.from >= range.to || range.to > state.doc.length) return Decoration.none;
        return Decoration.set([hoverDecoration.range(range.from, range.to)]);
    }),
});

export function setBlockHover(view: EditorView, block: BlockInfo | null): void {
    const next = block && block.kind !== 'frontmatter' ? { from: block.from, to: block.to } : null;
    const current = view.state.field(hoverField, false);
    if (current && next && current.from === next.from && current.to === next.to) return;
    if (!current && !next) return;
    view.dispatch({ effects: HOVER_EFFECT.of(next) });
}

function hoverPlugin(): Extension {
    return ViewPlugin.fromClass(
        class {
            private frame: number | null = null;
            private pendingX = 0;
            private pendingY = 0;
            private readonly dom: HTMLElement;

            constructor(private readonly view: EditorView) {
                this.dom = view.scrollDOM;
                this.dom.addEventListener('pointermove', this.onPointerMove);
                this.dom.addEventListener('pointerleave', this.onPointerLeave);
                this.dom.addEventListener('scroll', this.onScroll, { passive: true });
                this.dom.addEventListener('dragstart', this.onDragStart);
                this.dom.addEventListener('dragend', this.onDragEnd);
            }

            destroy() {
                this.cancelFrame();
                this.dom.removeEventListener('pointermove', this.onPointerMove);
                this.dom.removeEventListener('pointerleave', this.onPointerLeave);
                this.dom.removeEventListener('scroll', this.onScroll);
                this.dom.removeEventListener('dragstart', this.onDragStart);
                this.dom.removeEventListener('dragend', this.onDragEnd);
            }

            private readonly onPointerMove = (event: PointerEvent) => {
                this.pendingX = event.clientX;
                this.pendingY = event.clientY;
                if (this.frame !== null) return;
                this.frame = requestAnimationFrame(() => {
                    this.frame = null;
                    const pos = this.view.posAtCoords({ x: this.pendingX, y: this.pendingY });
                    if (pos === null) return;
                    setBlockHover(this.view, hoveredBlock(this.view.state.doc, pos));
                });
            };

            private readonly onPointerLeave = () => {
                this.cancelFrame();
                setBlockHover(this.view, null);
            };

            private readonly onScroll = () => {
                this.cancelFrame();
                setBlockHover(this.view, null);
            };

            private readonly onDragStart = () => {
                this.cancelFrame();
                setBlockHover(this.view, null);
            };

            private readonly onDragEnd = () => {
                setBlockHover(this.view, null);
            };

            private cancelFrame() {
                if (this.frame === null) return;
                cancelAnimationFrame(this.frame);
                this.frame = null;
            }
        },
    );
}

export function blockHoverExtension(options: { enabled: boolean; readOnly: boolean }): Extension {
    if (!options.enabled || !options.readOnly) return [];
    return [hoverField, hoverPlugin()];
}
