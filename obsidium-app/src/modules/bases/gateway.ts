import { invoke } from '@tauri-apps/api/core';
import type { BaseEvaluation, BaseQuery, BaseRow } from './types';

export function getBaseRows(workspacePath: string): Promise<BaseRow[]> {
  return invoke<BaseRow[]>('get_base_rows', { workspacePath });
}

export function queryBase(workspacePath: string, query: BaseQuery): Promise<BaseEvaluation> {
  return invoke<BaseEvaluation>('query_base', { workspacePath, query });
}
