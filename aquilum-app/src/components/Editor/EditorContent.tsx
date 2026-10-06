import { t } from '../../i18n';
import { useMemo, type RefObject } from 'react';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import type { Extension } from '@codemirror/state';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { CodeMirrorField, type CodeMirrorFieldRef } from '../Common/CodeMirrorField';
import { Menu } from '../Common/Menu';
import { collapseSelection } from './extensions/editorFocus';
import { wikiHoverHighlightTitle } from './extensions/wikiHoverHighlight';
import { useEditorBodyMenu } from './hooks/useEditorBodyMenu';
import { MetadataToggle } from './MetadataToggle';
import {
    bodyPositionUnderCaret,
    enterBodyFromTitle,
    focusBodyAt,
    hasNoModifiers,
    isOnLastVisualLine,
} from './titleCaret';

const BODY_SETUP = {
    lineNumbers: false,
    foldGutter: false,
    highlightActiveLineGutter: false,
    highlightActiveLine: true,
    searchKeymap: false,
};

function ignoreChange(): void { }

function collapseRefSelection(ref: RefObject<{ view?: EditorView | null } | null>): void {
    const view = ref.current?.view;
    if (view) collapseSelection(view);
}

interface EditorContentProps {
    titleRef: RefObject<CodeMirrorFieldRef | null>;
    bodyRef: RefObject<ReactCodeMirrorRef | null>;
    title: string;
    onCommitTitle: () => void;
    initialBody: string;
    selection: { anchor: number; head: number } | undefined;
    extensions: Extension[];
    autoLinkTitle: boolean;
    onCreateEditor: (view: EditorView) => void;
    onUpdate: (update: ViewUpdate) => void;
    hasFrontmatter?: boolean;
    metadataExpanded?: boolean;
    onToggleMetadata?: () => void;
}

export function EditorContent({
    titleRef,
    bodyRef,
    title,
    onCommitTitle,
    initialBody,
    selection,
    extensions,
    autoLinkTitle,
    onCreateEditor,
    onUpdate,
    hasFrontmatter = false,
    metadataExpanded = false,
    onToggleMetadata,
}: EditorContentProps) {
    const titleExtensions = useMemo(() => [wikiHoverHighlightTitle], []);
    const bodyMenu = useEditorBodyMenu(bodyRef, autoLinkTitle);

    return (
        <div className="q-editor-content" onContextMenu={bodyMenu.onContextMenu}>            <CodeMirrorField
                ref={titleRef}
                className="q-editor-inline-title-cm"
                value={title}
                ariaLabel={t('editor.titleAria')}
                mode="single-line"
                lineWrapping
                placeholder={t('editor.untitled')}
                extensions={titleExtensions}
                onBlur={onCommitTitle}
                onFocus={() => collapseRefSelection(bodyRef)}
                onKeyDown={(event, view) => {
                    const body = bodyRef.current?.view;
                    if (!body || !hasNoModifiers(event)) return false;
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        enterBodyFromTitle(body);
                        return true;
                    }
                    if (event.key === 'ArrowDown' && isOnLastVisualLine(view)) {
                        event.preventDefault();
                        focusBodyAt(body, bodyPositionUnderCaret(view, body));
                        return true;
                    }
                    return false;
                }}
            />
            {hasFrontmatter && onToggleMetadata ? (
                <MetadataToggle
                    expanded={metadataExpanded}
                    onToggle={onToggleMetadata}
                />
            ) : null}
            <CodeMirror
                ref={bodyRef}
                theme="none"
                value={initialBody}
                selection={selection}
                extensions={extensions}
                onChange={ignoreChange}
                onCreateEditor={onCreateEditor}
                onUpdate={onUpdate}
                onFocus={() => collapseRefSelection(titleRef)}
                indentWithTab={false}
                basicSetup={BODY_SETUP}
            />
            <Menu
                open={bodyMenu.open}
                position={bodyMenu.position}
                items={bodyMenu.items}
                onClose={bodyMenu.close}
                ariaLabel={t('editor.actions')}
            />
        </div>
    );
}

