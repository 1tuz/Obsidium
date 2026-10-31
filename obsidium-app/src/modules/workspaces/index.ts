import { invoke } from '@tauri-apps/api/core';
import { samePath } from '../paths';

export async function pickWorkspaceFolder(): Promise<string | null> {
  try {
    return await invoke<string | null>('pick_workspace_folder');
  } catch (error) {
    console.error('Failed to pick a workspace directory', error);
    return null;
  }
}

export interface KnownWorkspace {
  id: string;
  path: string;
  lastSeenMs: number;
  homePage: string;
}

export function listWorkspaces(): Promise<KnownWorkspace[]> {
  return invoke<KnownWorkspace[]>('list_ui_workspaces');
}

export async function lastOpenedWorkspace(): Promise<string | null> {
  const known = await listWorkspaces().catch((error) => {
    console.error('Failed to list known workspaces', error);
    return [] as KnownWorkspace[];
  });
  return known[0]?.path ?? null;
}

export async function workspaceHomePage(path: string): Promise<string> {
  const known = await listWorkspaces().catch((error) => {
    console.error('Failed to read the workspace home page', error);
    return [] as KnownWorkspace[];
  });
  return known.find((workspace) => samePath(workspace.path, path))?.homePage ?? '';
}

export function setWorkspaceHomePage(path: string, homePage: string): Promise<void> {
  return invoke<void>('set_ui_workspace_home_page', { path, homePage });
}

export function forgetWorkspace(workspaceId: string): Promise<void> {
  return invoke<void>('forget_ui_workspace', { workspaceId });
}
