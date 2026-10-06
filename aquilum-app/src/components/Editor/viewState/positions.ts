import * as Y from 'yjs';
import type { ViewState } from '../../../modules/ui-state';
import { documentText } from '../../../modules/docSync/applyExternalText';
import { clamp } from '../../../modules/math';

export function initialSelection(
  initial: ViewState | null,
  ydoc: Y.Doc,
  length: number,
  preferredPosition?: number,
): { anchor: number; head: number } | undefined {
  if (preferredPosition !== undefined) {
    const position = clamp(preferredPosition, 0, length);
    return { anchor: position, head: position };
  }
  if (!initial) return undefined;
  const ytext = documentText(ydoc);
  return {
    anchor: clamp(resolvePosition(initial.cursorAnchor, initial.fallbackAnchor, ydoc, ytext), 0, length),
    head: clamp(resolvePosition(initial.cursorHead, initial.fallbackHead, ydoc, ytext), 0, length),
  };
}

export function encodePosition(ytext: Y.Text, index: number): number[] {
  const relative = Y.createRelativePositionFromTypeIndex(ytext, clamp(index, 0, ytext.length));
  return Array.from(Y.encodeRelativePosition(relative));
}

export function resolvePosition(
  encoded: number[],
  fallback: number,
  ydoc: Y.Doc,
  ytext: Y.Text,
): number {
  try {
    if (encoded.length > 0) {
      const relative = Y.decodeRelativePosition(Uint8Array.from(encoded));
      const absolute = Y.createAbsolutePositionFromRelativePosition(relative, ydoc);
      if (absolute?.type === ytext) return clamp(absolute.index, 0, ytext.length);
    }
  } catch {
    return clamp(fallback, 0, ytext.length);
  }
  return clamp(fallback, 0, ytext.length);
}
