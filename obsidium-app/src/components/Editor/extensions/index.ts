import { useMemo } from 'react';
import { EditorView, placeholder } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { syntaxHighlighting, indentUnit } from '@codemirror/language';

import { livePreviewExtension } from './livePreviewPlugin';
import { listCalloutsExtension, outlineExtension, advancedOutlineExtension } from './outline';
import { coloredHighlightExtension } from './highlightr';
import { tablesExtension } from './tables';
import { bookCalloutTheme, type BookCalloutReadRequest } from './bookCallout';
import { dataviewTheme } from './dataview';
import { dataviewInlineExtension } from './dataview/inline';
import { baseFenceTheme } from './baseFence';
import { blockquoteTheme } from './blockquotePreview';
import { readerQuoteTheme } from './readerQuote';
import { imageEmbedExtension } from './image';
import { obsidiumEditorTheme, markdownStyles } from './theme';
import { formattingKeymap } from './formatting';
import { obsidiumCodeMirrorTheme } from '../../Common/codeMirror';
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
import { bodySetup } from './bodySetup';
import type { LinkDisposition, WikiLinkResolver } from '../../../modules/links';

export interface EditorExtensionConfig {
    resolveWikiLinks: WikiLinkResolver;
    onOpenWikiLink: (target: string, disposition: LinkDisposition) => void;
    onOpenExternalUrl: (url: string) => void;
    smartDashes?: boolean;
    listCallouts?: boolean;
    autoLinkTitle?: boolean;
    workspacePath?: string | null;
    onReadBookCallout?: (request: BookCalloutReadRequest) => void;
    notePath?: () => string;
    linkSuggest?: boolean;
    linkSuggestMinChars?: number;
    highlightrEnabled?: boolean;
    advancedOutlinerEnabled?: boolean;
}

export function useEditorExtensions({
    resolveWikiLinks,
    onOpenWikiLink,
    onOpenExternalUrl,
    smartDashes = true,
    listCallouts = true,
    autoLinkTitle = true,
    workspacePath = null,
    onReadBookCallout,
    notePath = () => '',
    linkSuggest = true,
    linkSuggestMinChars = 2,
    highlightrEnabled = true,
    advancedOutlinerEnabled = true,
}: EditorExtensionConfig) {
    return useMemo(() => {
        return [
            bodySetup,
            EditorState.tabSize.of(4),
            noteSuggestExtension({
                enabled: linkSuggest,
                workspacePath,
                minChars: linkSuggestMinChars,
            }),
            outlineExtension,
            ...(advancedOutlinerEnabled ? [advancedOutlineExtension] : []),
            listCalloutsExtension(listCallouts),
            tablesExtension,
            blockWidthExtension(),
            bookCalloutTheme,
            dataviewTheme,
            dataviewInlineExtension(),
            baseFenceTheme,
            blockquoteTheme,
            readerQuoteTheme,
            imageEmbedExtension,
            formattingKeymap,
            ...(highlightrEnabled ? [coloredHighlightExtension] : []),
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
            editorLinkExtension(onOpenWikiLink, onOpenExternalUrl, autoLinkTitle, workspacePath, notePath),
            codeBlockExtension,
            hashtagExtension,
            externalRevealExtension,
            wikiHoverHighlight,
            smartDashExtension(smartDashes),
            obsidiumCodeMirrorTheme,
            obsidiumEditorTheme,
            pageSearchExtension,
            EditorView.lineWrapping,
            placeholder("Начните писать текст..."),
        ];
    }, [autoLinkTitle, linkSuggest, linkSuggestMinChars, listCallouts, onOpenExternalUrl, onOpenWikiLink, onReadBookCallout, resolveWikiLinks, smartDashes, workspacePath, highlightrEnabled, advancedOutlinerEnabled, notePath]);
}
