import type { GraphEpoch, GraphSnapshot } from '../../modules/graph';
import { readFileSnapshot, writeFileAtomic } from '../../modules/documents/fileGateway';
import { relativePath } from '../../modules/paths';

interface IndexedSuggestion {
  path: string;
  node: number;
}

type FetchPaths = (epoch: GraphEpoch, indices: number[]) => Promise<string[]>;

export async function suggestionNodeIndices(
  snapshot: GraphSnapshot,
  paths: string[],
  fetchPaths: FetchPaths,
): Promise<IndexedSuggestion[]> {
  const byId = new Map<string, string[]>();
  for (const path of paths) {
    const id = stableNodeId(path);
    const key = `${Number(id >> 32n)}:${Number(id & 0xffff_ffffn)}`;
    const candidates = byId.get(key);
    if (candidates) candidates.push(path);
    else byId.set(key, [path]);
  }
  const matches: IndexedSuggestion[] = [];
  const indices: number[] = [];
  for (let node = 0; node < snapshot.nodeCount; node += 1) {
    const low = snapshot.nodeIds[node * 2];
    const high = snapshot.nodeIds[node * 2 + 1];
    const candidates = byId.get(`${high}:${low}`);
    if (!candidates) continue;
    candidates.forEach((path) => matches.push({ path, node }));
    indices.push(node);
  }
  if (indices.length === 0) return [];
  const indexedPaths = await fetchPaths(snapshot.epoch, indices);
  const valid = new Map<string, number>();
  indexedPaths.forEach((path, index) => {
    if (byId.get(`${snapshot.nodeIds[indices[index] * 2 + 1]}:${snapshot.nodeIds[indices[index] * 2]}`)
      ?.includes(path)) valid.set(path, indices[index]);
  });
  return matches.filter(({ path }) => valid.has(path)).map(({ path }) => ({
    path,
    node: valid.get(path)!,
  }));
}

export function appendWikiLink(content: string, path: string): string | null {
  const target = path.replace(/\\/g, '/').replace(/\.md$/i, '');
  const normalized = normalizeWikiTarget(target);
  for (const match of content.matchAll(/\[\[([^\]\r\n]+)\]\]/g)) {
    if (normalizeWikiTarget(match[1]!.split('|', 1)[0]!) === normalized) return null;
  }
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return `${content}${content && !content.endsWith('\n') ? newline : ''}[[${target}]]${newline}`;
}

export async function writeSuggestedLink(
  workspacePath: string,
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  const source = await readFileSnapshot(sourcePath);
  const target = relativePath(workspacePath, targetPath);
  const content = appendWikiLink(source.content, target);
  if (content === null) return false;
  await writeFileAtomic(sourcePath, content, source.hash);
  return true;
}

function normalizeWikiTarget(target: string): string {
  return target.trim().replace(/\\/g, '/').replace(/\.md$/i, '').toLocaleLowerCase();
}

function stableNodeId(path: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(path)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash;
}
