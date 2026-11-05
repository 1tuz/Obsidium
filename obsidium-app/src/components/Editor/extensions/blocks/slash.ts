import { EditorSelection, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { t } from '../../../../i18n';
import { blockAt } from '../../../../modules/blocks/model';
import { applyTurnInto, turnSelectionRange, type TurnTarget } from '../../../../modules/blocks/turnInto';
import { insertTable } from '../tables';
import { DIAGRAM_SKELETON } from '../diagram/constants';
import './slash.css';

export interface SlashItem {
    id: string;
    label: string;
    category: string;
    target?: TurnTarget;
    insert?: string;
}

export const SLASH_ITEMS: SlashItem[] = [
    { id: 'text', label: t('blocks.insertText'), category: 'basic', target: 'paragraph', insert: '' },
    { id: 'heading1', label: t('blocks.insertHeading1'), category: 'headings', target: 'heading1', insert: '# ' },
    { id: 'heading2', label: t('blocks.insertHeading2'), category: 'headings', target: 'heading2', insert: '## ' },
    { id: 'heading3', label: t('blocks.insertHeading3'), category: 'headings', target: 'heading3', insert: '### ' },
    { id: 'bullet', label: t('blocks.insertBullet'), category: 'lists', target: 'bullet', insert: '- ' },
    { id: 'ordered', label: t('blocks.insertOrdered'), category: 'lists', target: 'ordered', insert: '1. ' },
    { id: 'task', label: t('blocks.insertTask'), category: 'lists', target: 'task', insert: '- [ ] ' },
    { id: 'quote', label: t('blocks.insertQuote'), category: 'advanced', target: 'quote', insert: '> ' },
    { id: 'code', label: t('blocks.insertCode'), category: 'advanced', target: 'code', insert: '```\n\n```' },
    { id: 'diagram', label: t('blocks.insertDiagram'), category: 'advanced', insert: `${DIAGRAM_SKELETON}\n` },
    { id: 'toggle', label: t('blocks.insertToggle'), category: 'advanced', insert: `> [!note]- ${t('blocks.targetToggle')}` },
    { id: 'table', label: t('blocks.insertTable'), category: 'advanced' },
    { id: 'divider', label: t('blocks.insertDivider'), category: 'advanced', insert: '---' },
];

const CATEGORY_LABEL: Record<string, string> = {
    basic: t('blocks.categoryBasic'),
    headings: t('blocks.categoryHeadings'),
    lists: t('blocks.categoryLists'),
    advanced: t('blocks.categoryAdvanced'),
};

const SLASH_TRIGGER = /^(?:\s*(?:[-*+]|\d+[.)])\s+)?\/$/;
const SLASH_QUERY = /^(?:\s*(?:[-*+]|\d+[.)])\s+)?\/(\S*)$/;

export function filterSlashItems(query: string, items: SlashItem[]): SlashItem[] {
    const needle = query.trim().toLowerCase();
    if (!needle) return items.slice();
    return items.filter(
        (item) =>
            item.label.toLowerCase().includes(needle) ||
            item.id.toLowerCase().includes(needle) ||
            item.category.toLowerCase().includes(needle),
    );
}

interface SlashSession {
    from: number;
    to: number;
    query: string;
    items: SlashItem[];
    activeIndex: number;
}

interface QueryInfo {
    from: number;
    to: number;
    query: string;
}

function slashQueryBefore(source: string, pos: number): QueryInfo | null {
    const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
    const match = SLASH_QUERY.exec(source.slice(lineStart, pos));
    if (!match) return null;
    const query = match[1]!;
    return { from: pos - 1 - query.length, to: pos, query };
}

function lineBeforeCursor(source: string, pos: number): string {
    const lineStart = source.lastIndexOf('\n', pos - 1) + 1;
    return source.slice(lineStart, pos);
}

class SlashMenu {
    private session: SlashSession | null = null;
    private readonly panel: HTMLElement;
    private rows: HTMLElement[] = [];

    constructor(private readonly view: EditorView) {
        this.panel = document.createElement('div');
        this.panel.className = 'q-block-slash';
        this.panel.setAttribute('role', 'listbox');
        this.panel.addEventListener('mousedown', (event) => {
            event.preventDefault();
            const row = (event.target as HTMLElement).closest('.q-block-slash__row') as HTMLElement | null;
            if (row) this.executeIndex(Number(row.dataset.index));
        });
    }

    destroy(): void {
        this.close();
    }

    isOpen(): boolean {
        return this.session !== null;
    }

    getPanel(): HTMLElement {
        return this.panel;
    }

    handleUpdate(update: ViewUpdate): void {
        if (!update.docChanged && !update.selectionSet) return;
        this.sync();
    }

    move(direction: 1 | -1): boolean {
        const session = this.session;
        if (!session || !session.items.length) return false;
        session.activeIndex = (session.activeIndex + direction + session.items.length) % session.items.length;
        this.paint();
        return true;
    }

    jump(toEnd: boolean): boolean {
        const session = this.session;
        if (!session || !session.items.length) return false;
        session.activeIndex = toEnd ? session.items.length - 1 : 0;
        this.paint();
        return true;
    }

    execute(): boolean {
        const session = this.session;
        if (!session) return false;
        const item = session.items[session.activeIndex];
        if (!item) return false;
        this.executeItem(item);
        return true;
    }

    close(): void {
        this.session = null;
        this.rows = [];
        if (this.panel.parentElement) this.panel.remove();
    }

    private executeIndex(index: number): void {
        const item = this.session?.items[index];
        if (item) this.executeItem(item);
    }

    private executeItem(item: SlashItem): void {
        const session = this.session;
        if (!session) return;
        this.close();
        this.view.focus();
        if (item.id === 'table') {
            this.applyTable(session);
            return;
        }
        if (item.id === 'divider') {
            this.applyDivider(session);
            return;
        }
        const block = blockAt(this.view.state.doc.toString(), session.from);
        const blockHasText = block !== null && block.text.trim() !== '';
        if (item.target && blockHasText) {
            this.applyTurnInto(session, item.target);
            return;
        }
        this.applyMarkup(session, item.insert ?? '');
    }

    private applyMarkup(session: SlashSession, markup: string): void {
        this.view.dispatch({
            changes: { from: session.from, to: session.to, insert: markup },
            selection: EditorSelection.cursor(session.from + markup.length),
            scrollIntoView: true,
            userEvent: 'input',
        });
    }

    private applyTurnInto(session: SlashSession, target: TurnTarget): void {
        const source = this.view.state.doc.toString();
        const withoutToken = source.slice(0, session.from) + source.slice(session.to);
        const range = turnSelectionRange(withoutToken, session.from, session.from);
        const next = applyTurnInto(withoutToken, [range], target);
        const caret = Math.min(session.from + 1, next.length);
        this.view.dispatch({
            changes: { from: 0, to: source.length, insert: next },
            selection: EditorSelection.cursor(caret),
            scrollIntoView: true,
            userEvent: 'input',
        });
    }

    private applyTable(session: SlashSession): void {
        if (insertTable(this.view)) return;
        const skeleton = '|     |\n| --- |\n|     |\n';
        this.view.dispatch({
            changes: { from: session.from, to: session.to, insert: skeleton },
            selection: EditorSelection.cursor(session.from + skeleton.length),
            scrollIntoView: true,
            userEvent: 'input',
        });
    }

    private applyDivider(session: SlashSession): void {
        const block = blockAt(this.view.state.doc.toString(), session.from);
        const below = block !== null && block.to > session.to && block.text.trim() !== '';
        const insert = below ? '\n---\n' : '---\n';
        this.view.dispatch({
            changes: { from: session.from, to: session.to, insert },
            selection: EditorSelection.cursor(session.from + insert.length),
            scrollIntoView: true,
            userEvent: 'input',
        });
    }

    sync(): void {
        const state = this.view.state;
        const source = state.doc.toString();
        const head = state.selection.main.head;
        const query = slashQueryBefore(source, head);
        if (!query || !this.view.hasFocus || state.readOnly) {
            this.close();
            return;
        }
        const session = this.session;
        if (!session) {
            if (!SLASH_TRIGGER.test(lineBeforeCursor(source, head))) {
                this.close();
                return;
            }
            this.session = { ...query, items: SLASH_ITEMS.slice(), activeIndex: 0 };
        } else {
            if (session.from !== query.from) {
                this.close();
                return;
            }
            session.to = query.to;
            session.query = query.query;
        }
        const next = this.session!;
        next.items = filterSlashItems(next.query, SLASH_ITEMS);
        if (next.activeIndex >= next.items.length) next.activeIndex = Math.max(0, next.items.length - 1);
        this.render();
    }

    private render(): void {
        const session = this.session;
        this.panel.textContent = '';
        this.rows = [];
        if (!session) return;
        if (!session.items.length) {
            const empty = document.createElement('div');
            empty.className = 'q-block-slash__empty';
            empty.textContent = t('blocks.slashEmpty');
            this.panel.append(empty);
            this.mount();
            return;
        }
        const seenCategories = new Map<string, SlashItem[]>();
        for (const item of session.items) {
            const bucket = seenCategories.get(item.category);
            if (bucket) bucket.push(item);
            else seenCategories.set(item.category, [item]);
        }
        for (const [category, categoryItems] of seenCategories) {
            const section = document.createElement('div');
            section.className = 'q-block-slash__section';
            const header = document.createElement('div');
            header.className = 'q-block-slash__category';
            header.textContent = CATEGORY_LABEL[category] ?? category;
            section.append(header);
            for (const item of categoryItems) {
                const row = document.createElement('div');
                row.className = 'q-block-slash__row';
                row.setAttribute('role', 'option');
                row.dataset.index = String(session.items.indexOf(item));
                row.textContent = item.label;
                if (session.items[session.activeIndex] === item) {
                    row.classList.add('q-block-slash__row--active');
                    row.setAttribute('aria-selected', 'true');
                }
                this.rows.push(row);
                section.append(row);
            }
            this.panel.append(section);
        }
        this.mount();
    }

    private paint(): void {
        const session = this.session;
        if (!session) return;
        for (const row of this.rows) {
            const isActive = Number(row.dataset.index) === session.activeIndex;
            row.classList.toggle('q-block-slash__row--active', isActive);
            if (isActive) {
                row.setAttribute('aria-selected', 'true');
                row.scrollIntoView({ block: 'nearest' });
            } else {
                row.removeAttribute('aria-selected');
            }
        }
    }

    private mount(): void {
        if (!this.panel.parentElement) {
            (this.view.dom.parentElement ?? document.body).append(this.panel);
        }
        // The menu opens from a view update, where CodeMirror forbids layout reads.
        // requestMeasure defers the coordinate read until after the update finishes.
        this.view.requestMeasure({
            key: this,
            read: (view) => view.coordsAtPos(view.state.selection.main.head, -1),
            write: (coords) => {
                if (!coords || !this.panel.isConnected) return;
                this.panel.style.left = `${coords.left}px`;
                this.panel.style.top = `${coords.bottom + 4}px`;
            },
        });
    }
}

const slashMenus = new WeakMap<EditorView, SlashMenu>();

function withSlashMenu(view: EditorView, action: (menu: SlashMenu) => boolean): boolean {
    const menu = slashMenus.get(view);
    if (!menu || !menu.isOpen()) return false;
    return action(menu);
}

export function slashMenuExtension(options: { enabled: boolean; readOnly: boolean }): Extension {
    if (!options.enabled || options.readOnly) return [];
    return [
        Prec.highest(
            keymap.of([
                { key: 'ArrowDown', run: (view) => withSlashMenu(view, (menu) => menu.move(1)) },
                { key: 'ArrowUp', run: (view) => withSlashMenu(view, (menu) => menu.move(-1)) },
                { key: 'Home', run: (view) => withSlashMenu(view, (menu) => menu.jump(false)) },
                { key: 'End', run: (view) => withSlashMenu(view, (menu) => menu.jump(true)) },
                { key: 'Enter', run: (view) => withSlashMenu(view, (menu) => menu.execute()) },
                { key: 'Escape', run: (view) => withSlashMenu(view, (menu) => { menu.close(); return true; }) },
                { key: 'Tab', run: (view) => withSlashMenu(view, () => true) },
            ]),
        ),
        ViewPlugin.fromClass(
            class {
                private readonly menu: SlashMenu;
                private readonly dom: HTMLElement;
                private readonly view: EditorView;

                constructor(view: EditorView) {
                    this.menu = new SlashMenu(view);
                    this.dom = view.dom;
                    this.view = view;
                    slashMenus.set(view, this.menu);
                    this.dom.addEventListener('blur', this.onBlur);
                    document.addEventListener('pointerdown', this.onPointerDown, true);
                }

                update(update: ViewUpdate): void {
                    this.menu.handleUpdate(update);
                }

                destroy(): void {
                    this.menu.destroy();
                    this.dom.removeEventListener('blur', this.onBlur);
                    document.removeEventListener('pointerdown', this.onPointerDown, true);
                    slashMenus.delete(this.view);
                }

                private readonly onBlur = (): void => {
                    this.menu.close();
                };

                private readonly onPointerDown = (event: PointerEvent): void => {
                    if (this.menu.getPanel().contains(event.target as Node)) return;
                    this.menu.close();
                };
            },
        ),
    ];
}
