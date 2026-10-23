import { dataviewErrorMessage, runDataviewQuery } from '../../../../modules/docs/dataview';
import { dataviewQueriesInText } from './constructs';
import { cachedDataviewResult, dataviewCacheNoteKey, rememberDataviewResult } from './store';

const inFlight = new Map<string, Promise<boolean>>();

function flightKey(workspacePath: string, notePath: string, query: string): string {
  return `${workspacePath}\0${notePath}\0${query}`;
}

export function evaluateDataviewQuery(
  workspacePath: string,
  notePath: string,
  query: string,
): Promise<boolean> {
  const key = flightKey(workspacePath, notePath, query);
  const cacheNotePath = dataviewCacheNoteKey(workspacePath, notePath);
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = runDataviewQuery(workspacePath, notePath, query)
    .then((output) => rememberDataviewResult(cacheNotePath, query, { status: 'ready', output }))
    .catch((error) => rememberDataviewResult(cacheNotePath, query, {
      status: 'failed',
      message: dataviewErrorMessage(error),
    }))
    .finally(() => inFlight.delete(key));

  inFlight.set(key, request);
  return request;
}

export async function warmDataviewResults(
  workspacePath: string | null | undefined,
  notePath: string,
  text: string,
): Promise<void> {
  if (!workspacePath) return;
  const cacheNotePath = dataviewCacheNoteKey(workspacePath, notePath);
  const queries = [...new Set(dataviewQueriesInText(text))]
    .filter((query) => !cachedDataviewResult(cacheNotePath, query));
  await Promise.all(queries.map((query) => evaluateDataviewQuery(workspacePath, notePath, query)));
}
