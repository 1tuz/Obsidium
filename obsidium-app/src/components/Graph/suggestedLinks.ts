import type { GraphEpoch, GraphSnapshot } from '../../modules/graph';
import { applySuggestedLink } from '../../modules/links';

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

export async function writeSuggestedLink(
  workspacePath: string,
  sourcePath: string,
  targetPath: string,
): Promise<boolean> {
  const result = await applySuggestedLink(workspacePath, sourcePath, targetPath);
  return result.changed;
}

function stableNodeId(path: string): bigint {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(path)) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  }
  return hash;
}
