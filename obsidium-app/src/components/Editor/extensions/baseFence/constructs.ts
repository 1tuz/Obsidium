import type { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { codeBlocks } from '../codeBlock/blocks';
import { BASE_FENCE_LANGUAGE } from './constants';

export interface BaseFenceBlock {
  from: number;
  to: number;
  path: string;
  view: string | null;
}

export function findBaseFences(state: EditorState): BaseFenceBlock[] {
  const tree = syntaxTree(state);
  const blocks = codeBlocks(tree, state.doc, [{ from: 0, to: state.doc.length }]);
  const found: BaseFenceBlock[] = [];

  for (const block of blocks) {
    if (block.info.toLowerCase() !== BASE_FENCE_LANGUAGE) continue;
    const parsed = parseBaseFenceBody(state.doc.sliceString(block.contentFrom, block.contentTo));
    if (!parsed) continue;
    found.push({ from: block.from, to: block.end, ...parsed });
  }
  return found;
}

export function parseBaseFenceBody(body: string): { path: string; view: string | null } | null {
  const line = body.split('\n').map((candidate) => candidate.trim()).find(Boolean);
  if (!line) return null;

  const first = takeToken(line);
  if (!first || !/\.base$/i.test(first.token)) return null;
  const second = takeToken(first.rest);
  return { path: first.token, view: second?.token ?? null };
}

function takeToken(text: string): { token: string; rest: string } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const quoted = /^(["'])(.*?)\1\s*([\s\S]*)$/.exec(trimmed);
  if (quoted) return { token: quoted[2]!.trim(), rest: quoted[3]! };
  const plain = /^(\S+)\s*([\s\S]*)$/.exec(trimmed);
  return plain ? { token: plain[1]!, rest: plain[2]! } : null;
}
