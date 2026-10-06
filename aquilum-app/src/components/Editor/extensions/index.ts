import { useMemo } from 'react';
import { yCollab } from 'y-codemirror.next';
import { EditorView, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { syntaxHighlighting, indentUnit } from '@codemirror/language';
import * as Y from 'yjs';

import { livePreviewExtension } from './livePreviewPlugin';
import { listCalloutsExtension, outlineExtension } from './outline';
import { tablesExtension } from './tables';
import { bookCalloutTheme, type BookCalloutReadRequest } from './bookCallout';
import { dataviewTheme } from './dataview';
import { blockquoteTheme } from './blockquotePreview';
import { readerQuoteTheme } from './readerQuote';
import { imageEmbedExtension } from './image';
import { aquilumEditorTheme, markdownStyles } from './theme';
import { formattingKeymap } from './formatting';
import { aquilumCodeMirrorTheme } from '../../Common/codeMirror';
import { editorLinkExtension } from './links';
import { blockWidthExtension } from './blockWidth';
import { editorMarkdownSupport } from './markdownConfig';
import { codeBlockExtension } from './codeBlock';
import { hashtagExtension } from './hashtags';
import { externalRevealExtension } from './externalReveal';
import { frontmatterBlock } from './frontmatterBlock';
import { frontmatterPaste } from './frontmatterPaste';
import { wikiHoverHighlight } from './wikiHoverHighlight';
import { smartDashExtension } from './smartDash';
import { pageSearchExtension } from './pageSearch';
import { noteSuggestExtension } from './suggest';
import type { LinkDisposition, WikiLinkResolver } from '../../../modules/links';
import { documentText } from '../../../modules/docSync/applyExternalText';

export function useEditorExtensions(
    ydoc: Y.Doc,
    isReady: boolean,
    resolveWikiLinks: WikiLinkResolver,
    onOpenWikiLink: (target: string, disposition: LinkDisposition) => void,
    onOpenExternalUrl: (url: string) => void,
    smartDashes = true,
    listCallouts = true,
    autoLinkTitle = true,
    workspacePath: string | null = null,
    onReadBookCallout?: (request: BookCalloutReadRequest) => void,
    notePath: () => string = () => '',
    linkSuggest = true,
    linkSuggestMinChars = 2,
) {
    return useMemo(() => {
        if (!isReady) return [];

        const ytext = documentText(ydoc);

        return [
            EditorState.tabSize.of(4),
            noteSuggestExtension({
                enabled: linkSuggest,
                workspacePath,
                minChars: linkSuggestMinChars,
            }),
            outlineExtension,
            listCalloutsExtension(listCallouts),
            tablesExtension,
            blockWidthExtension(),
            bookCalloutTheme,
            dataviewTheme,
            blockquoteTheme,
            readerQuoteTheme,
            imageEmbedExtension,
            formattingKeymap,
            indentUnit.of("\t"),
            editorMarkdownSupport,
            syntaxHighlighting(markdownStyles),
            frontmatterBlock,
            frontmatterPaste,
            livePreviewExtension({
                resolveWikiLinks,
                workspacePath,
                notePath,
                onOpenWikiLink,
                onOpenExternalUrl,
                onReadBook: onReadBookCallout ?? (() => {}),
            }),
            editorLinkExtension(onOpenWikiLink, onOpenExternalUrl, autoLinkTitle),
            codeBlockExtension,
            hashtagExtension,
            externalRevealExtension,
            wikiHoverHighlight,
            smartDashExtension(smartDashes),
            aquilumCodeMirrorTheme,
            aquilumEditorTheme,
            pageSearchExtension,
            EditorView.lineWrapping,
            placeholder("Начните писать текст..."),
            yCollab(ytext, null)
        ];
    }, [autoLinkTitle, isReady, linkSuggest, linkSuggestMinChars, listCallouts, onOpenExternalUrl, onOpenWikiLink, onReadBookCallout, resolveWikiLinks, smartDashes, workspacePath, ydoc]);
}
