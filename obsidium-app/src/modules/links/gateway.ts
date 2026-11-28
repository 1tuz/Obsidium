import { invoke } from '@tauri-apps/api/core';
import type { Backlink, OutgoingLink, SuggestedLinkResult, WikiLinkResolution } from './types';

export function getBacklinks(workspacePath: string, documentPath: string): Promise<Backlink[]> {
  return invoke<Backlink[]>('get_backlinks', { workspacePath, documentPath });
}

export function getOutgoingLinks(
  workspacePath: string,
  documentPath: string,
): Promise<OutgoingLink[]> {
  return invoke<OutgoingLink[]>('get_outgoing_links', { workspacePath, documentPath });
}

export function resolveWikiLinks(
  workspacePath: string,
  sourcePath: string,
  targets: string[],
): Promise<WikiLinkResolution> {
  return invoke<WikiLinkResolution>('resolve_wiki_links', { workspacePath, sourcePath, targets });
}

export function applySuggestedLink(
  workspacePath: string,
  sourcePath: string,
  targetPath: string,
): Promise<SuggestedLinkResult> {
  return invoke<SuggestedLinkResult>('apply_suggested_link', {
    workspace: workspacePath,
    source: sourcePath,
    target: targetPath,
  });
}

export function resolveMarkdownLink(workspacePath: string, sourcePath: string, target: string): Promise<string | null> {
  return invoke<string | null>('resolve_markdown_link', { workspacePath, sourcePath, target });
}
