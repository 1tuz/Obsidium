import { invoke } from '@tauri-apps/api/core';

export interface WorkspaceImage {
  path: string;
  size: number;
  mtime: number;
}

export function listWorkspaceImages(workspacePath: string): Promise<WorkspaceImage[]> {
  return invoke<WorkspaceImage[]>('list_workspace_images', { workspacePath });
}
