import { useCallback, useState, type MouseEvent, type RefObject } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { BookOpen, Table2, Tags } from 'lucide-react';
import { t } from '../../../i18n';
import type { MenuItem } from '../../Common/Menu';
import { useSelectionMenu } from '../../Common/useSelectionMenu';
import { insertClipboardAsLink } from '../extensions/links';
import { insertBookCallout } from '../extensions/bookCallout';
import { insertTable } from '../extensions/tables';
import { canInsertFrontmatter, insertFrontmatter } from '../extensions/frontmatterInsert';

export function useEditorBodyMenu(
    bodyRef: RefObject<ReactCodeMirrorRef | null>,
    autoLinkTitle: boolean,
) {
    const getView = useCallback(() => bodyRef.current?.view, [bodyRef]);
    const selectionMenu = useSelectionMenu(getView);
    const [frontmatterDisabled, setFrontmatterDisabled] = useState(false);

    const paste = useCallback(async () => {
        const view = bodyRef.current?.view;
        if (!view) return;
        const text = await navigator.clipboard.readText();
        if (!text) return;
        if (autoLinkTitle && insertClipboardAsLink(view, text)) {
            view.focus();
            return;
        }
        view.dispatch(view.state.replaceSelection(text));
        view.focus();
    }, [autoLinkTitle, bodyRef]);

    const insertBodyTable = useCallback(() => {
        const view = bodyRef.current?.view;
        if (!view) return;
        insertTable(view);
    }, [bodyRef]);

    const insertBodyFrontmatter = useCallback(() => {
        const view = bodyRef.current?.view;
        if (!view) return;
        insertFrontmatter(view);
    }, [bodyRef]);

    const insertBodyBook = useCallback(() => {
        const view = bodyRef.current?.view;
        if (!view) return;
        insertBookCallout(view);
    }, [bodyRef]);

    const openSelectionMenu = selectionMenu.onContextMenu;
    const onContextMenu = useCallback((event: MouseEvent) => {
        if ((event.target as HTMLElement).closest('.q-editor-inline-title-cm')) return;
        const state = bodyRef.current?.view?.state;
        setFrontmatterDisabled(state ? !canInsertFrontmatter(state) : true);
        openSelectionMenu(event);
    }, [bodyRef, openSelectionMenu]);

    const items: MenuItem[] = [
        selectionMenu.copy,
        {
            id: 'paste',
            label: t('common.paste'),
            onSelect: () => { void paste(); },
        },
        {
            id: 'insert-book',
            label: t('editor.insertBook'),
            icon: BookOpen,
            onSelect: insertBodyBook,
        },
        {
            id: 'insert-table',
            label: t('editor.insertTable'),
            icon: Table2,
            onSelect: insertBodyTable,
        },
        {
            id: 'insert-frontmatter',
            label: t('editor.insertFrontmatter'),
            icon: Tags,
            disabled: frontmatterDisabled,
            onSelect: insertBodyFrontmatter,
        },
    ];

    return {
        open: selectionMenu.open,
        position: selectionMenu.position,
        close: selectionMenu.close,
        items,
        onContextMenu,
    };
}
