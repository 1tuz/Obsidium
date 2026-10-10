import { listVaultSnippetFiles, readFileSnapshot } from '../documents/fileGateway';

const STYLE_SELECTOR = 'style[data-obsidium-vault-snippet]';

export interface VaultSnippet {
  name: string;
  path: string;
}

let applyGeneration = 0;

export async function listVaultSnippets(workspacePath: string | null): Promise<VaultSnippet[]> {
  if (!workspacePath) return [];
  const entries = await listVaultSnippetFiles(workspacePath);
  return entries
    .filter(({ type, name }) => type === 'file' && name.toLowerCase().endsWith('.css'))
    .map(({ name, id }) => ({ name, path: id }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function applyVaultSnippets(
  workspacePath: string | null,
  enabledByVault: Record<string, string[]>,
): Promise<void> {
  const generation = ++applyGeneration;
  const head = document.head;
  head.querySelectorAll(STYLE_SELECTOR).forEach((style) => style.remove());
  if (!workspacePath) return;
  const enabledNames = enabledByVault[workspacePath] ?? [];
  if (enabledNames.length === 0) return;

  const snippets = await listVaultSnippets(workspacePath);
  const enabled = snippets.filter(({ name }) => enabledNames.includes(name));
  const contents = await Promise.all(enabled.map(async (snippet) => ({
    ...snippet,
    content: (await readFileSnapshot(snippet.path)).content,
  })));
  if (generation !== applyGeneration) return;

  for (const snippet of contents) {
    const style = document.createElement('style');
    style.dataset.obsidiumVaultSnippet = snippet.name;
    style.textContent = snippet.content;
    head.append(style);
  }
}
