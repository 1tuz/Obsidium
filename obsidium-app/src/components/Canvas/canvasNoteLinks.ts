import { splitLinkTarget } from '../../modules/links/fragment';
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
  if (value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return null;
  const parts = splitLinkTarget(value);
  return parts?.target ? { ...parts, source } : null;
}

export function isNoteMarkdownPath(target: string): boolean {
  const path = target.split(/[?#]/, 1)[0] ?? '';
  try {
    return /\.md$/i.test(decodeURIComponent(path).replace(/\\/g, '/'));
  } catch {
    return false;
  }
}
