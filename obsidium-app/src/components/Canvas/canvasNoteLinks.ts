import { noteEmbedOffset } from '../../modules/docs/noteEmbeds';
import type { ResolvedNotePath } from '../../modules/paths';

export type CanvasNoteSource = 'wiki' | 'markdown';

export interface CanvasNoteLink {
  target: string;
  fragment: string;
  source: CanvasNoteSource;
}

export interface CanvasNoteTarget {
  target: string;
  fragment: string;
  source: CanvasNoteSource;
  path: ResolvedNotePath | null;
}


export function splitNoteLink(raw: string, source: CanvasNoteLink['source']): CanvasNoteLink | null {
  const value = raw.trim().replace(/^<|>$/g, '');
  if (!value || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  const hash = value.indexOf('#');
  const target = (hash < 0 ? value : value.slice(0, hash)).trim();
  let fragment = hash < 0 ? '' : value.slice(hash + 1).trim();
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    fragment = hash < 0 ? '' : value.slice(hash + 1).trim();
  }
  return target ? { target, fragment, source } : null;
}

export function isNoteMarkdownPath(target: string): boolean {
  const path = target.split(/[?#]/, 1)[0] ?? '';
  try {
    return /\.md$/i.test(decodeURIComponent(path).replace(/\\/g, '/'));
  } catch {
    return false;
  }
}

export function resolveNoteFragmentOffset(source: string, fragment: string): number | null {
  const wanted = fragment.trim();
  if (!wanted) return 0;
  return wanted.startsWith('^')
    ? noteEmbedOffset(source, null, wanted.slice(1))
    : noteEmbedOffset(source, wanted);
}

