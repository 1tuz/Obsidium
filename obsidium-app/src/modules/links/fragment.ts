import { noteEmbedOffset } from '../docs/noteEmbeds';

export interface LinkTargetParts {
  target: string;
  fragment: string;
}

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

export function resolveFragmentOffset(content: string, fragment: string): number | null {
  const wanted = fragment.trim();
  if (!wanted) return 0;
  return wanted.startsWith('^')
    ? noteEmbedOffset(content, null, wanted.slice(1))
    : noteEmbedOffset(content, wanted);
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}
