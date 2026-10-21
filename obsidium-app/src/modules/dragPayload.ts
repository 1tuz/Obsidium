export type NoteDragPayload = { kind: 'note'; path: string; name: string };

export type NoteDropTarget = (payload: NoteDragPayload, clientX: number, clientY: number) => void;

let payload: NoteDragPayload | null = null;
let target: NoteDropTarget | null = null;

export function setNoteDragPayload(next: NoteDragPayload | null): void {
  payload = next;
}

export function getNoteDragPayload(): NoteDragPayload | null {
  return payload;
}

export function registerNoteDropTarget(next: NoteDropTarget): () => void {
  target = next;
  return () => {
    if (target === next) target = null;
  };
}

export function dropNoteOnTarget(note: NoteDragPayload, clientX: number, clientY: number): boolean {
  if (!target) return false;
  target(note, clientX, clientY);
  return true;
}
