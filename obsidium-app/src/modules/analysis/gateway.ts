import { invoke } from '@tauri-apps/api/core';
import type { AnalysisMethod, AnalysisResult } from './types';
import type { KnowledgeReport } from './report';

export function analyzeDocument(
  workspacePath: string,
  documentPath: string,
  method: AnalysisMethod,
  limit = 50,
): Promise<AnalysisResult[]> {
  return invoke<AnalysisResult[]>('analyze_document', {
    workspacePath,
    documentPath,
    method,
    limit,
  });
}

export function knowledgeReport(
  workspacePath: string,
  staleAfterDays: number,
): Promise<KnowledgeReport> {
  return invoke<KnowledgeReport>('get_knowledge_report', { workspacePath, staleAfterDays });
}
