import { invoke } from '@tauri-apps/api/core';

export interface CalendarEvent {
  path: string;
  date: string;
  time: string | null;
  title: string;
  line: number;
  byteOffset: number;
}

export function getCalendarEvents(workspacePath: string, year: number, month: number): Promise<CalendarEvent[]> {
  return invoke<CalendarEvent[]>('get_calendar_events', { workspacePath, year, month });
}