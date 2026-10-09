import type { Backlink, OutgoingLink } from '../../modules/links';

export interface LocalGraphNode {
  path: string;
  title: string;
  depth: number;
}

export interface LocalGraphEdge {
  from: string;
  to: string;
}

export interface LocalGraphResult {
  nodes: LocalGraphNode[];
  edges: LocalGraphEdge[];
}

export interface LocalGraphGateway {
  backlinks: (workspacePath: string, documentPath: string) => Promise<Backlink[]>;
  outgoing: (workspacePath: string, documentPath: string) => Promise<OutgoingLink[]>;
}

export interface LocalGraphOptions {
  workspacePath: string;
  documentPath: string;
  depth: 1 | 2;
  incoming: boolean;
  outgoing: boolean;
  maxNodes?: number;
}

function stem(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const name = normalized.slice(normalized.lastIndexOf('/') + 1);
  return name.replace(/\.md$/i, '');
}

export async function buildLocalGraph(
  options: LocalGraphOptions,
  gateway: LocalGraphGateway,
): Promise<LocalGraphResult> {
  const maxNodes = options.maxNodes ?? 48;
  const nodes = new Map<string, LocalGraphNode>();
  const edges = new Map<string, LocalGraphEdge>();
  nodes.set(options.documentPath, {
    path: options.documentPath,
    title: stem(options.documentPath),
    depth: 0,
  });

  let frontier = [options.documentPath];
  for (let level = 0; level < options.depth && frontier.length > 0; level += 1) {
    const next = new Set<string>();
    await Promise.all(frontier.map(async (path) => {
      const [incoming, outgoing] = await Promise.all([
        options.incoming ? gateway.backlinks(options.workspacePath, path) : Promise.resolve([]),
        options.outgoing ? gateway.outgoing(options.workspacePath, path) : Promise.resolve([]),
      ]);
      for (const link of incoming) {
        const edge = { from: link.path, to: path };
        edges.set(`${edge.from}\0${edge.to}`, edge);
        if (!nodes.has(link.path) && nodes.size < maxNodes) {
          nodes.set(link.path, { path: link.path, title: link.title || stem(link.path), depth: level + 1 });
          next.add(link.path);
        }
      }
      for (const link of outgoing) {
        if (!link.path) continue;
        const edge = { from: path, to: link.path };
        edges.set(`${edge.from}\0${edge.to}`, edge);
        if (!nodes.has(link.path) && nodes.size < maxNodes) {
          nodes.set(link.path, { path: link.path, title: link.title || stem(link.path), depth: level + 1 });
          next.add(link.path);
        }
      }
    }));
    frontier = [...next];
  }

  const included = new Set(nodes.keys());
  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()].filter((edge) => included.has(edge.from) && included.has(edge.to)),
  };
}
