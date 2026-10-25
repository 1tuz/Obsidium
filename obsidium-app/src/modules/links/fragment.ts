import { noteEmbedOffset } from '../docs/noteEmbeds';
import { blockOffset } from './blocks';

export enum FragmentKind {
  Heading = 'heading',
  Block = 'block',
}

export interface ParsedFragment {
  kind: FragmentKind;
  value: string;
}

export interface LinkTargetParts {
  target: string;
  fragment: string;
}

const BLOCK_ID = /^[A-Za-z0-9-]+$/;

export function splitLinkTarget(raw: string): LinkTargetParts | null {
  const value = raw.trim().replace(/^<|>$/g, '');
  if (!value) return null;
  const hash = value.indexOf('#');
  if (hash < 0) return { target: value, fragment: '' };
  return {
    target: value.slice(0, hash).trim(),
    fragment: decodeFragment(value.slice(hash + 1).trim()),
  };
}

export function parseFragment(fragment: string): ParsedFragment | null {
  const trimmed = fragment.trim().replace(/^#+/, '').trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('^')) return { kind: FragmentKind.Heading, value: trimmed };
  const id = trimmed.slice(1);
  return BLOCK_ID.test(id) ? { kind: FragmentKind.Block, value: id } : null;
}

export function resolveFragmentOffset(content: string, fragment: string): number | null {
  if (!fragment.trim()) return 0;
  const parsed = parseFragment(fragment);
  if (!parsed) return null;
  return parsed.kind === FragmentKind.Block
    ? blockOffset(content, parsed.value)
    : noteEmbedOffset(content, parsed.value);
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
