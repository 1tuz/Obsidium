import { invoke } from '@tauri-apps/api/core';

export interface JournalNote {
  path: string;
  created: boolean;
}

export function journalToday(workspacePath: string): Promise<JournalNote> {
  return invoke<JournalNote>('journal_today', { workspacePath });
}

export function journalDates(workspacePath: string): Promise<string[]> {
  return invoke<string[]>('journal_dates', { workspacePath });
}

export function journalNotePath(workspacePath: string, date: string): Promise<string> {
  const [year, month, day] = date.split('-').map(Number);
  return invoke<string>('journal_note', { workspacePath, year, month, day });
}
