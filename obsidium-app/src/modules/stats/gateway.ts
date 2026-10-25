import { invoke } from '@tauri-apps/api/core';
import type { ActivityMeasure, ActivityNote, NoteTimestamp } from './activity';

export const RECENT_CHANGES_LIMIT = 20;

export function loadNoteTimestamps(workspacePath: string): Promise<NoteTimestamp[]> {
  return invoke<NoteTimestamp[]>('get_note_activity', { workspacePath });
}

export function loadDayNotes(
  workspacePath: string,
  day: string,
  measure: ActivityMeasure,
): Promise<ActivityNote[]> {
  return invoke<ActivityNote[]>('get_note_day_notes', {
    workspacePath,
    day,
    measure,
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
  });
}

export function loadRecentChanges(
  workspacePath: string,
  limit = RECENT_CHANGES_LIMIT,
): Promise<ActivityNote[]> {
  return invoke<ActivityNote[]>('get_recent_changes', { workspacePath, limit });
}
