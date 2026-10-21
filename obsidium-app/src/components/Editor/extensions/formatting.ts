import { StateCommand, EditorSelection, Prec } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { keymap, type Command, type KeyBinding } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { codeMirrorKey, SHORTCUTS } from "../../../config/shortcuts";
import { inlineMarkdownEdit } from "../toolbarMarkdown";
import { findAncestor } from "./syntaxAncestor";

function createToggleCommand(
    targetNodeName: string,
    wrapString: string,
    markerRegex: RegExp
): StateCommand {
    return ({ state, dispatch }) => {
        let hasChanges = false;

        const spec = state.changeByRange(range => {
            const tree = syntaxTree(state);

            const isTarget = (node: SyntaxNode) => node.name === targetNodeName;
            const targetNode = findAncestor(tree.resolveInner(range.head, 1), isTarget)
                ?? findAncestor(tree.resolveInner(range.head, -1), isTarget);

            if (targetNode) {
                const text = state.sliceDoc(targetNode.from, targetNode.to);
                const markMatch = text.match(markerRegex);

                if (markMatch) {
                    hasChanges = true;
                    const markLen = markMatch[1].length;

                    const getNewPos = (p: number) => {
                        if (p <= targetNode.from) return p;
                        if (p <= targetNode.from + markLen) return targetNode.from;
                        if (p <= targetNode.to - markLen) return p - markLen;
                        if (p <= targetNode.to) return targetNode.to - (markLen * 2);
                        return p - (markLen * 2);
                    };

                    return {
                        changes: [
                            { from: targetNode.from, to: targetNode.from + markLen, insert: "" },
                            { from: targetNode.to - markLen, to: targetNode.to, insert: "" }
                        ],
                        range: EditorSelection.range(getNewPos(range.anchor), getNewPos(range.head))
                    };
                }
            }

            if (range.empty) {
                return { range };
            } else {
                hasChanges = true;
                return {
                    changes: [
                        { from: range.from, insert: wrapString },
                        { from: range.to, insert: wrapString }
                    ],
                    range: EditorSelection.range(range.anchor + wrapString.length, range.head + wrapString.length)
                };
            }
        });

        if (hasChanges) {
            dispatch(state.update(spec, { scrollIntoView: true, userEvent: "input" }));
        }

        return true;
    };
}

export const toggleBoldCommand = createToggleCommand("StrongEmphasis", "**", /^(\*\*|__)(.*)(\*\*|__)$/s);
export const toggleItalicCommand = createToggleCommand("Emphasis", "*", /^(\*|_)(.*)(\*|_)$/s);
export const toggleStrikeCommand = createToggleCommand("Strikethrough", "~~", /^(~~)(.*)(~~)$/s);

export function inlineWrapCommand(marker: string): Command {
    return (view) => {
        const state = view.state;
        const source = state.doc.toString();
        const spec = state.changeByRange(range => {
            const edit = inlineMarkdownEdit(source, range.from, range.to, marker);
            return {
                changes: { from: edit.from, to: edit.to, insert: edit.insert },
                range: EditorSelection.range(edit.anchor, edit.head)
            };
        });
        view.dispatch(state.update(spec, { scrollIntoView: true, userEvent: "input" }));
        return true;
    };
}

function createLinkCommand(image: boolean): Command {
    return (view) => {
        const state = view.state;
        const spec = state.changeByRange(range => {
            const selected = state.doc.sliceString(range.from, range.to);
            const label = selected || (image ? "alt" : "link");
            const prefix = image ? "![" : "[";
            const insert = `${prefix}${label}](https://)`;
            const start = selected ? range.from + prefix.length + label.length + 2 : range.from + prefix.length;
            const end = selected ? start + 8 : start + label.length;
            return {
                changes: { from: range.from, to: range.to, insert },
                range: EditorSelection.range(start, end)
            };
        });
        view.dispatch(state.update(spec, { scrollIntoView: true, userEvent: "input" }));
        return true;
    };
}

export const toggleHighlightCommand = inlineWrapCommand("==");
export const toggleInlineCodeCommand = inlineWrapCommand("`");
export const insertLinkCommand = createLinkCommand(false);
export const insertImageCommand = createLinkCommand(true);

export const formattingKeyBindings: readonly KeyBinding[] = [
    { key: codeMirrorKey(SHORTCUTS.BOLD), run: toggleBoldCommand },
    { key: codeMirrorKey(SHORTCUTS.ITALIC), run: toggleItalicCommand },
    { key: codeMirrorKey(SHORTCUTS.STRIKETHROUGH), run: toggleStrikeCommand },
    { key: codeMirrorKey(SHORTCUTS.HIGHLIGHT), run: toggleHighlightCommand },
    { key: codeMirrorKey(SHORTCUTS.INLINE_CODE), run: toggleInlineCodeCommand },
    { key: codeMirrorKey(SHORTCUTS.LINK), run: insertLinkCommand }
];

export const formattingKeymap = Prec.highest(keymap.of(formattingKeyBindings));
