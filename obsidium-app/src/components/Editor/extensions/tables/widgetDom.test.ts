// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseMarkdownTable } from './markdown';
import { tableThemeSpec } from './theme';
import { refitTableColumns, renderTableWidgetDom, setWrapperText } from './widgetDom';

function explicitModel() {
    return parseMarkdownTable([
        '| A | B | C | D |',
        '| --- | --- | --- | --- |',
        '| 1 | 2 | 3 | 4 |',
        '<!--q-table:{"merges":[],"rows":[40,40],"cols":[60,60,60,60]}-->',
    ].join('\n'))!;
}

function stubHostWidth(root: HTMLElement, width: number): void {
    const host = root.querySelector('.q-md-table-table-host') as HTMLElement;
    Object.defineProperty(host, 'clientWidth', { value: width, configurable: true });
}

function tableOf(root: HTMLElement): HTMLTableElement {
    return root.querySelector('.q-md-table-editor') as HTMLTableElement;
}

describe('table widget widths', () => {
    it('fills the container by scaling explicit widths', () => {
        const model = explicitModel();
        const root = renderTableWidgetDom(model);
        stubHostWidth(root, 900);
        refitTableColumns(root, model);

        expect(tableOf(root).style.width).toBe('900px');
        const cols = [...tableOf(root).querySelectorAll('col')];
        expect(cols.map((col) => col.style.width)).toEqual(['225px', '225px', '225px', '225px']);
    });

    it('keeps the strip labels on the same widths as the columns', () => {
        const model = explicitModel();
        const root = renderTableWidgetDom(model);
        stubHostWidth(root, 900);
        refitTableColumns(root, model);

        const buttons = [...root.querySelectorAll<HTMLElement>('.q-md-table-col-strip-btn')];
        expect(buttons.map((button) => button.style.width)).toEqual(['225px', '225px', '225px', '225px']);
    });

    it('falls back to the stored widths before the host is measured', () => {
        const model = explicitModel();
        const root = renderTableWidgetDom(model);
        expect(tableOf(root).style.width).toBe('240px');
    });

    it('keeps the add controls outside the cell grid', () => {
        const root = renderTableWidgetDom(explicitModel());
        const table = tableOf(root);
        const addCol = root.querySelector('.q-md-table-add-col') as HTMLElement;
        const addRow = root.querySelector('.q-md-table-add-row') as HTMLElement;

        expect(table.contains(addCol)).toBe(false);
        expect(table.contains(addRow)).toBe(false);
        expect(addCol.parentElement?.className).toBe('q-md-table-layout');
        expect(addRow.parentElement?.className).toBe('q-md-table-layout');
    });

    it('wraps at word boundaries instead of mid-word', () => {
        const root = renderTableWidgetDom(explicitModel());
        const wrapper = root.querySelector('.q-md-table-cell-wrapper') as HTMLElement;
        expect(wrapper).not.toBeNull();
        expect(tableThemeSpec['.q-md-table-cell-wrapper'].overflowWrap).toBe('break-word');
        expect(tableThemeSpec['.q-md-table-cell-wrapper'].wordBreak).toBe('normal');
    });
});

function cellModel(values: string[]) {
    const row = `| ${values.join(' | ')} |`;
    const delimiter = `| ${values.map(() => '---').join(' | ')} |`;
    return parseMarkdownTable([row, delimiter, row].join('\n'))!;
}

function bodyWrappers(root: HTMLElement): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>('.q-md-table-editor tbody tr:nth-child(2) .q-md-table-cell-wrapper')];
}

describe('table cell inline markdown', () => {
    it('renders a markdown link with its label as the anchor text', () => {
        const root = renderTableWidgetDom(cellModel(['[jvm-e2e.md](x.md)']));
        const anchor = bodyWrappers(root)[0].querySelector('a') as HTMLAnchorElement;

        expect(anchor).not.toBeNull();
        expect(anchor.textContent).toBe('jvm-e2e.md');
        expect(anchor.getAttribute('href')).toBe('x.md');
        expect(anchor.getAttribute('rel')).toContain('noopener');
    });

    it('renders inline code, emphasis and strikethrough', () => {
        const root = renderTableWidgetDom(cellModel(['`code`', '**bold**', '*italic*', '~~gone~~']));
        const wrappers = bodyWrappers(root);

        expect(wrappers[0].querySelector('code')?.textContent).toBe('code');
        expect(wrappers[1].querySelector('strong')?.textContent).toBe('bold');
        expect(wrappers[2].querySelector('em')?.textContent).toBe('italic');
        expect(wrappers[3].querySelector('del')?.textContent).toBe('gone');
    });

    it('renders a bare url autolink as an anchor', () => {
        const root = renderTableWidgetDom(cellModel(['<https://a.example>']));
        const anchor = bodyWrappers(root)[0].querySelector('a') as HTMLAnchorElement;

        expect(anchor.textContent).toBe('https://a.example');
        expect(anchor.getAttribute('href')).toBe('https://a.example');
    });

    it('keeps whole-cell wiki links delegated by class and target', () => {
        const root = renderTableWidgetDom(cellModel(['[[Note]]']));
        const link = bodyWrappers(root)[0].querySelector('.q-md-table-wiki-link') as HTMLElement;

        expect(link).not.toBeNull();
        expect(link.dataset.wikiTarget).toBe('Note');
        expect(link.textContent).toBe('Note');
    });

    it('keeps plain text untouched', () => {
        const root = renderTableWidgetDom(cellModel(['plain text']));
        const wrapper = bodyWrappers(root)[0];

        expect(wrapper.textContent).toBe('plain text');
        expect(wrapper.querySelector('*')).toBeNull();
    });

    it('falls back to raw text when the renderer produces blocks', () => {
        const wrapper = document.createElement('div');
        setWrapperText(wrapper, '# heading\n\n- item');

        expect(wrapper.querySelector('h1, ul, p')).toBeNull();
        expect(wrapper.textContent).toBe('# heading\n\n- item');
    });
});

describe('table column sizing attribute', () => {
    it('marks the table as auto sized for parsed tables', () => {
        const model = cellModel(['a', 'b']);
        const root = renderTableWidgetDom(model);

        expect(model.colSizing).toBe('auto');
        expect(tableOf(root).dataset.sizing).toBe('auto');
        expect(tableThemeSpec['.q-md-table-editor[data-sizing="auto"]'].tableLayout).toBe('auto');
        expect(tableThemeSpec['.q-md-table-editor'].tableLayout).toBe('fixed');
    });

    it('marks the table as explicitly sized when widths are stored', () => {
        const root = renderTableWidgetDom(explicitModel());

        expect(tableOf(root).dataset.sizing).toBe('explicit');
    });
});
