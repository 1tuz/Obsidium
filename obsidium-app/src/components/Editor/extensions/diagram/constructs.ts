import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { codeBlocks } from '../codeBlock/blocks';
import { DIAGRAM_LANGUAGE } from './constants';

export interface DiagramBlock {
  from: number;
  to: number;
  source: string;
}

export function findDiagramBlocks(state: EditorState): DiagramBlock[] {
  const blocks = codeBlocks(syntaxTree(state), state.doc, [{ from: 0, to: state.doc.length }]);
  const found: DiagramBlock[] = [];

  for (const block of blocks) {
    if (block.info.toLowerCase() !== DIAGRAM_LANGUAGE) continue;
    const source = state.doc.sliceString(block.contentFrom, block.contentTo).trim();
    if (!source) continue;
    found.push({ from: block.from, to: block.end, source });
  }
  return found;
}
