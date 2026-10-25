import type { PrefetchDelays } from '../prefetchScheduler';

export const BASE_FENCE_LANGUAGE = 'base';

export const MAX_CACHED_NOTES = 8;
export const MAX_CACHED_FENCES_PER_NOTE = 32;
export const UNKNOWN_HEIGHT = -1;

export const BASE_FENCE_PREFETCH_DELAYS: PrefetchDelays = {
  editMs: 250,
  revisionMs: 0,
};

export const BASE_FENCE_CLASSES = {
  root: 'q-md-base-fence',
  card: 'q-md-base-fence-card',
  pending: 'q-md-base-fence-card--pending',
  failed: 'q-md-base-fence-card--failed',
  head: 'q-md-base-fence-head',
  headName: 'q-md-base-fence-head-name',
  headCount: 'q-md-base-fence-head-count',
  message: 'q-md-base-fence-message',
} as const;

export const BASE_FENCE_SELECTOR = `.${BASE_FENCE_CLASSES.card}`;
