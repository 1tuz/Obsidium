const OPEN_NOTE_EVENT = 'obsidium:open-note';

export interface OpenNoteRequest {
  path: string;
  offset?: number;
}

export function requestOpenNote(path: string, offset?: number): void {
  window.dispatchEvent(new CustomEvent<OpenNoteRequest>(OPEN_NOTE_EVENT, {
    detail: offset === undefined ? { path } : { path, offset },
  }));
}

export function onOpenNoteRequest(handler: (request: OpenNoteRequest) => void): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<OpenNoteRequest>).detail;
    if (detail && typeof detail.path === 'string') handler(detail);
  };
  window.addEventListener(OPEN_NOTE_EVENT, listener);
  return () => window.removeEventListener(OPEN_NOTE_EVENT, listener);
}
