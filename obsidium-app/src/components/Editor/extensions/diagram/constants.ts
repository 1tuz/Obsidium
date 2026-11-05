import type { PrefetchDelays } from '../prefetchScheduler';

export const DIAGRAM_LANGUAGE = 'mermaid';

export const MAX_CACHED_DIAGRAMS = 40;
export const UNKNOWN_DIAGRAM_HEIGHT = -1;

export const DIAGRAM_PREFETCH_DELAYS: PrefetchDelays = {
  editMs: 200,
  revisionMs: 0,
};

export const DIAGRAM_CLASSES = {
  root: 'q-md-diagram',
  frame: 'q-md-diagram-frame',
  pending: 'q-md-diagram-frame--pending',
  failed: 'q-md-diagram-frame--failed',
  message: 'q-md-diagram-message',
  svg: 'q-md-diagram-svg',
} as const;

export const DIAGRAM_SELECTOR = `.${DIAGRAM_CLASSES.frame}`;

export const DIAGRAM_SKELETON = '```mermaid\nflowchart TD\n    A[Start] --> B{Choice}\n    B -->|yes| C[Do it]\n    B -->|no| D[Skip]\n```';
