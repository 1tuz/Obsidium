import { t } from '../../i18n';
import type { MarkdownReadingSettings } from '../../modules/settings';
import { useMemo, type RefObject } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { CodeMirrorField, type CodeMirrorFieldRef } from '../Common/CodeMirrorField';
import { CodeMirrorView } from '../Common/CodeMirrorView';
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

function collapseViewSelection(view: EditorView | null | undefined): void {
    if (view) collapseSelection(view);
}

interface EditorContentProps {
    titleRef: RefObject<CodeMirrorFieldRef | null>;
    bodyRef: RefObject<EditorView | null>;
    title: string;
    onCommitTitle: () => void;
    initialBody: string;
    selection: { anchor: number; head: number } | undefined;
    extensions: Extension[];
    autoLinkTitle: boolean;
    readOnly?: boolean;
    onCreateEditor: (view: EditorView) => void;
    onUpdate: (update: ViewUpdate) => void;
    hasFrontmatter?: boolean;
    metadataExpanded?: boolean;
    onToggleMetadata?: () => void;
    markdownReading: MarkdownReadingSettings;
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
    readOnly = false,
    onCreateEditor,
    onUpdate,
    hasFrontmatter = false,
    metadataExpanded = false,
    onToggleMetadata,
    markdownReading,
}: EditorContentProps) {
    const titleExtensions = useMemo(() => [wikiHoverHighlightTitle], []);
    const bodyExtensions = useMemo<Extension[]>(() => [
        extensions,
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
    ], [extensions, readOnly]);
    const bodyMenu = useEditorBodyMenu(bodyRef, autoLinkTitle);

    const paperStyle = markdownReading.style === 'theme' ? undefined : markdownReading.style;
    const readingStyle = paperStyle ? {
        '--q-editor-font-size': `${markdownReading.fontSizePx}px`,
        '--q-editor-line-height': String(markdownReading.lineHeight),
        '--q-editor-max-width': `${markdownReading.pageWidthCh}ch`,
    } : undefined;

    return (
        <div
            className={`q-editor-content${readOnly ? ' q-editor-content--reading' : ''}`}
            data-reading-style={paperStyle}
            data-reading-texture={paperStyle ? markdownReading.texture : undefined}
            data-reading-font={paperStyle ? markdownReading.font : undefined}
            style={readingStyle}
            onContextMenu={readOnly ? undefined : bodyMenu.onContextMenu}
        >
            <CodeMirrorField
                ref={titleRef}
                className="q-editor-inline-title-cm"
                value={title}
                ariaLabel={t('editor.titleAria')}
                mode="single-line"
                lineWrapping
                placeholder={t('editor.untitled')}
                disabled={readOnly}
                extensions={titleExtensions}
                onBlur={onCommitTitle}
                onFocus={() => collapseViewSelection(bodyRef.current)}
                onKeyDown={(event, view) => {
                    const body = bodyRef.current;
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
            <div className="q-editor-content__body">
                <CodeMirrorView
                    viewRef={bodyRef}
                    doc={initialBody}
                    selection={selection}
                    extensions={bodyExtensions}
                    onCreate={onCreateEditor}
                    onUpdate={onUpdate}
                    onFocus={() => collapseViewSelection(titleRef.current?.view)}
                />
            </div>
            <Menu
                open={!readOnly && bodyMenu.open}
                position={bodyMenu.position}
                items={bodyMenu.items}
                onClose={bodyMenu.close}
                ariaLabel={t('editor.actions')}
            />
        </div>
    );
}
