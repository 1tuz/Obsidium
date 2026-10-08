import { invoke } from '@tauri-apps/api/core';
import type { BaseRow } from './types';

export function getBaseRows(workspacePath: string): Promise<BaseRow[]> {
  return invoke<BaseRow[]>('get_base_rows', { workspacePath });
}
