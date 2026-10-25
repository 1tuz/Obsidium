import { invoke } from '@tauri-apps/api/core';
import type { ObjectSchema, Violation } from './types';

export function getSchema(workspacePath: string): Promise<ObjectSchema> {
  return invoke<ObjectSchema>('get_schema', { workspacePath });
}

export function saveSchema(workspacePath: string, schema: ObjectSchema): Promise<ObjectSchema> {
  return invoke<ObjectSchema>('save_schema', { workspacePath, schema });
}

export function validateNote(workspacePath: string, path: string): Promise<Violation[]> {
  return invoke<Violation[]>('validate_note', { workspacePath, path });
}

function payloadMessage(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  if ('details' in error && typeof error.details === 'object' && error.details !== null
    && 'message' in error.details && typeof error.details.message === 'string') {
    return error.details.message;
  }
  if ('message' in error && typeof error.message === 'string') return error.message;
  return null;
}

export function schemaErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return payloadMessage(error) ?? String(error);
}
