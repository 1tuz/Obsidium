import { t } from '../../../../i18n';
import { parseBase, queryBase, type BaseDefinition } from '../../../../modules/bases';
import { readFileSnapshot } from '../../../../modules/documents/fileGateway';
import { absolutePath, comparablePath } from '../../../../modules/paths';
import { baseFenceKey, rememberBaseFenceResult, type BaseFenceResult } from './store';

const inFlight = new Map<string, Promise<boolean>>();

export function resolveBaseFencePath(workspacePath: string, raw: string): string | null {
  const normalized = raw.trim().replace(/\\/g, '/');
  if (!/\.base$/i.test(normalized)) return null;

  const root = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const inside = comparablePath(normalized).startsWith(`${comparablePath(root)}/`)
    ? normalized.slice(root.length + 1)
    : normalized.replace(/^\/+/, '');

  const segments: string[] = [];
  for (const segment of inside.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') return null;
    segments.push(segment);
  }
  if (segments.length === 0) return null;
  return absolutePath(workspacePath, segments.join('/'));
}

export function resolveBaseFenceViewIndex(
  definition: BaseDefinition,
  view: string | null,
): number | null {
  if (definition.views.length === 0) return null;
  if (view === null) return 0;
  const wanted = view.trim().toLowerCase();
  const index = definition.views.findIndex(
    (candidate) => candidate.name.trim().toLowerCase() === wanted,
  );
  return index === -1 ? null : index;
}

export function evaluateBaseFence(
  workspacePath: string,
  cacheNotePath: string,
  revision: number,
  basePath: string,
  view: string | null,
): Promise<boolean> {
  const key = baseFenceKey(basePath, view);
  const flightKey = `${comparablePath(workspacePath)}\0${key}\0${revision}`;
  const pending = inFlight.get(flightKey);
  if (pending) return pending;

  const request = loadBaseFence(workspacePath, basePath, view)
    .then((result) => rememberBaseFenceResult(cacheNotePath, key, revision, result))
    .catch((error) => rememberBaseFenceResult(cacheNotePath, key, revision, {
      status: 'failed',
      message: t('bases.fenceError', { reason: error instanceof Error ? error.message : String(error) }),
    }))
    .finally(() => inFlight.delete(flightKey));

  inFlight.set(flightKey, request);
  return request;
}

async function loadBaseFence(
  workspacePath: string,
  basePath: string,
  view: string | null,
): Promise<BaseFenceResult> {
  const snapshot = await readFileSnapshot(basePath);
  const definition = parseBase(snapshot.content);
  const viewIndex = resolveBaseFenceViewIndex(definition, view);
  if (viewIndex === null) {
    return {
      status: 'failed',
      message: view === null
        ? t('bases.fenceNoViews')
        : t('bases.fenceViewMissing', { view }),
    };
  }
  const evaluation = await queryBase(workspacePath, { definition, viewIndex, sort: [] });
  return { status: 'ready', definition, evaluation, viewIndex };
}
