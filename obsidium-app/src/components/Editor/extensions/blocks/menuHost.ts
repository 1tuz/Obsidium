import type { EditorView } from '@codemirror/view';
import type { MenuEntry, MenuPosition } from '../../../Common/Menu';

export interface BlockMenuRequest {
  id: number;
  items: MenuEntry[];
  position: MenuPosition;
  ariaLabel: string;
  exclude?: HTMLElement | null;
}

type BlockMenuListener = (request: BlockMenuRequest | null) => void;

const listeners = new WeakMap<EditorView, BlockMenuListener>();
let nextId = 1;

export function setBlockMenuHost(view: EditorView, listener: BlockMenuListener | null): void {
  if (listener) {
    listeners.set(view, listener);
    return;
  }
  listeners.delete(view);
}

export function openBlockMenu(
  view: EditorView,
  request: Omit<BlockMenuRequest, 'id'>,
): void {
  listeners.get(view)?.({ ...request, id: nextId++ });
}

export function closeBlockMenu(view: EditorView): void {
  listeners.get(view)?.(null);
}

export function hasBlockMenuHost(view: EditorView): boolean {
  return listeners.has(view);
}
