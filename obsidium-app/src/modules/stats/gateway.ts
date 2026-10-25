import { invoke } from '@tauri-apps/api/core';
import type { NoteTimestamp } from './activity';

export function loadNoteTimestamps(workspacePath: string): Promise<NoteTimestamp[]> {
  return invoke<NoteTimestamp[]>('get_note_activity', { workspacePath });
}
