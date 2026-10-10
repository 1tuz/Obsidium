import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight } from 'lucide';
import { Chip } from '../Common/Chip';
import { Icon } from '../Common/Icon';
import { t } from '../../i18n';
import { getBacklinks, getOutgoingLinks, type LinkDisposition } from '../../modules/links';
import {
  buildLocalGraph,
  type LocalGraphOptions,
  type LocalGraphResult,
} from './localGraphModel';
import './LocalGraph.css';

interface LocalGraphProps {
  workspacePath: string;
  documentPath: string;
  indexReady: boolean;
  indexRevision: number;
  isOpen: boolean;
  onOpen: (path: string, disposition: LinkDisposition) => void;
}

type Depth = LocalGraphOptions['depth'];

type PositionedNode = LocalGraphResult['nodes'][number] & { x: number; y: number };

function dispositionFromEvent(event: MouseEvent<Element>): LinkDisposition {
  return event.ctrlKey || event.metaKey ? 'new-tab' : 'current';
}

function positions(result: LocalGraphResult): PositionedNode[] {
  const center = 150;
  const byDepth = new Map<number, LocalGraphResult['nodes']>();
  for (const node of result.nodes) {
    const group = byDepth.get(node.depth) ?? [];
    group.push(node);
    byDepth.set(node.depth, group);
  }
  return result.nodes.map((node) => {
    if (node.depth === 0) return { ...node, x: center, y: center };
    const ring = byDepth.get(node.depth) ?? [node];
    const index = ring.findIndex((candidate) => candidate.path === node.path);
    const angle = -Math.PI / 2 + (index / Math.max(ring.length, 1)) * Math.PI * 2;
    const radius = node.depth === 1 ? 88 : 132;
    return {
      ...node,
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    };
  });
}

export function LocalGraph({
  workspacePath,
  documentPath,
  indexReady,
  indexRevision,
  isOpen,
  onOpen,
}: LocalGraphProps) {
  const [depth, setDepth] = useState<Depth>(1);
  const [incoming, setIncoming] = useState(true);
  const [outgoing, setOutgoing] = useState(true);
  const [result, setResult] = useState<LocalGraphResult | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isOpen || !indexReady) return;
    let cancelled = false;
    setFailed(false);
    setResult(null);
    void buildLocalGraph({
      workspacePath,
      documentPath,
      depth,
      incoming,
      outgoing,
      maxNodes: 48,
    }, { backlinks: getBacklinks, outgoing: getOutgoingLinks })
      .then((next) => { if (!cancelled) setResult(next); })
      .catch((error) => {
        console.error('Failed to build local graph', error);
        if (!cancelled) setFailed(true);
      });
    return () => { cancelled = true; };
  }, [depth, documentPath, incoming, indexReady, indexRevision, isOpen, outgoing, workspacePath]);

  const nodes = useMemo(() => result ? positions(result) : [], [result]);
  const nodeByPath = useMemo(() => new Map(nodes.map((node) => [node.path, node])), [nodes]);

  return (
    <div className="q-local-graph">
      <div className="q-local-graph__controls">
        <Chip
          label={t('localGraph.incoming')}
          selected={incoming}
          onClick={() => setIncoming((value) => !value)}
        />
        <Chip
          label={t('localGraph.outgoing')}
          selected={outgoing}
          onClick={() => setOutgoing((value) => !value)}
        />
        <span className="q-local-graph__spacer" />
        <Chip label="1" selected={depth === 1} onClick={() => setDepth(1)} />
        <Chip label="2" selected={depth === 2} onClick={() => setDepth(2)} />
        <Chip label="3" selected={depth === 3} onClick={() => setDepth(3)} />
        <Chip label="4" selected={depth === 4} onClick={() => setDepth(4)} />
      </div>

      {failed ? (
        <p className="q-panel-empty">{t('localGraph.error')}</p>
      ) : !result ? (
        <p className="q-panel-empty">{t('localGraph.loading')}</p>
      ) : result.nodes.length <= 1 ? (
        <p className="q-panel-empty">{t('localGraph.empty')}</p>
      ) : (
        <div className="q-local-graph__canvas">
          <svg viewBox="0 0 300 300" role="img" aria-label={t('localGraph.title')}>
            <defs>
              <marker id="q-local-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" />
              </marker>
            </defs>
            {result.edges.map((edge) => {
              const from = nodeByPath.get(edge.from);
              const to = nodeByPath.get(edge.to);
              return from && to ? (
                <line
                  key={`${edge.from}:${edge.to}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  markerEnd="url(#q-local-graph-arrow)"
                />
              ) : null;
            })}
            {nodes.map((node) => (
              <g
                key={node.path}
                className={node.depth === 0 ? 'q-local-graph__node is-root' : 'q-local-graph__node'}
                transform={`translate(${node.x} ${node.y})`}
                role={node.depth === 0 ? undefined : 'button'}
                tabIndex={node.depth === 0 ? undefined : 0}
                onClick={(event) => { if (node.depth > 0) onOpen(node.path, dispositionFromEvent(event)); }}
                onKeyDown={(event) => {
                  if (node.depth > 0 && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onOpen(node.path, event.metaKey || event.ctrlKey ? 'new-tab' : 'current');
                  }
                }}
              >
                <circle r={node.depth === 0 ? 9 : 6} />
                <text y={node.y > 245 ? -10 : 16} textAnchor="middle">
                  {node.title.length > 18 ? `${node.title.slice(0, 17)}…` : node.title}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}
      <div className="q-local-graph__legend" aria-hidden="true">
        <span><Icon icon={ArrowDownLeft} />{t('localGraph.incoming')}</span>
        <span><Icon icon={ArrowUpRight} />{t('localGraph.outgoing')}</span>
      </div>
    </div>
  );
}
