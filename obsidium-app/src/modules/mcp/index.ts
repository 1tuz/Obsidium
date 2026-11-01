import { invoke } from '@tauri-apps/api/core';

export interface McpStatus {
  running: boolean;
  port: number;
  executable: string;
  error?: string;
}

export interface ConnectWorkspaceReport {
  workspace: string;
  claude: 'created' | 'unchanged';
  codex: 'created' | 'unchanged';
}

export function getMcpStatus(): Promise<McpStatus> {
  return invoke<McpStatus>('get_mcp_status');
}

export function applyMcpSettings(): Promise<McpStatus> {
  return invoke<McpStatus>('apply_mcp_settings');
}

export function connectMcpWorkspace(path: string): Promise<ConnectWorkspaceReport> {
  return invoke<ConnectWorkspaceReport>('connect_mcp_workspace', { path });
}

export function setActiveNote(path: string | null): Promise<void> {
  return invoke<void>('set_active_note', { path });
}

export function createMcpToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

export { useMcpNavigation, useActiveNoteReport } from './useMcpNavigation';
