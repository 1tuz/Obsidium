import type { Text } from '@codemirror/state';
import type { SyntaxNode, SyntaxNodeRef, Tree } from '@lezer/common';

const BLOCK_NODES = ['FencedCode', 'CodeBlock'];

export interface CodeBlockShape {
  from: number;
  end: number;
  info: string;
  infoFrom: number;
  contentFrom: number;
  contentTo: number;
  fenced: boolean;
}

export interface CodeLanguageChange {
  from: number;
  to: number;
  insert: string;
}

function codeBlockShape(node: SyntaxNodeRef, doc: Text): CodeBlockShape {
  const openingLine = doc.lineAt(node.from);
  const info = node.node.getChild('CodeInfo');
  const marks = node.node.getChildren('CodeMark');
  const closingMark = marks[marks.length - 1];
  const lastLine = doc.lineAt(Math.max(node.from, Math.min(node.to, doc.length) - 1));
  const fenced = node.name === 'FencedCode';
  return {
    from: openingLine.from,
    end: lastLine.to,
    info: info ? doc.sliceString(info.from, info.to).trim() : '',
    infoFrom: info?.from ?? openingLine.to,
    contentFrom: fenced
      ? openingLine.to < doc.length ? openingLine.to + 1 : openingLine.to
      : openingLine.from,
    contentTo: fenced
      ? closingMark && closingMark.from > openingLine.to ? closingMark.from : node.to
      : lastLine.to,
    fenced,
  };
}

export function codeBlocks(
  tree: Tree,
  doc: Text,
  ranges: readonly { from: number; to: number }[],
): CodeBlockShape[] {
  const blocks: CodeBlockShape[] = [];
  const seen = new Set<number>();

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to: Math.min(to, tree.length),
      enter(node) {
        if (!BLOCK_NODES.includes(node.name)) return;
        const start = doc.lineAt(node.from).from;
        if (seen.has(start)) return;
        seen.add(start);
        blocks.push(codeBlockShape(node, doc));
      },
    });
  }

  return blocks.sort((a, b) => a.from - b.from);
}

export function codeLanguageChange(block: CodeBlockShape, language: string): CodeLanguageChange {
  const current = /\S+/.exec(block.info)?.[0];
  if (!language) {
    return current && !current.includes('=')
      ? { from: block.infoFrom, to: block.infoFrom + current.length, insert: '' }
      : { from: block.infoFrom, to: block.infoFrom, insert: '' };
  }
  if (!current) return { from: block.infoFrom, to: block.infoFrom, insert: language };
  return current.includes('=')
    ? { from: block.infoFrom, to: block.infoFrom, insert: `${language} ` }
    : { from: block.infoFrom, to: block.infoFrom + current.length, insert: language };
}

export function isFenceMark(node: { name: string; node: SyntaxNode }): boolean {
  return node.name === 'CodeMark' && node.node.parent?.name === 'FencedCode';
}
