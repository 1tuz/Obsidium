import { animate } from 'motion/mini';
import { motionEnabled } from '../theme';

export type ViewTransitionKind = 'theme' | 'view';

interface ViewTransitionLike {
  finished: Promise<unknown>;
  skipTransition?: () => void;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
};

export interface MotionTransitionOptions {
  prepare?: () => void;
  cleanup?: () => void;
}

interface ActiveTransition {
  kind: ViewTransitionKind;
  supersede: () => void;
  cleanup: () => void;
}

type PendingUpdate = () => void | Promise<void>;

let active: ActiveTransition | null = null;
let pendingUpdate: PendingUpdate | null = null;
const generation: Record<ViewTransitionKind, number> = { theme: 0, view: 0 };

function runPendingUpdate(carried: PendingUpdate | null, update: () => void | Promise<void>) {
  if (!carried) return update();
  try {
    const result = carried();
    return result instanceof Promise
      ? result.then(update, (error) => {
        console.error('Failed to apply superseded motion update', error);
        return update();
      })
      : update();
  } catch (error) {
    console.error('Failed to apply superseded motion update', error);
    return update();
  }
}

export function runMotionTransition(
  kind: ViewTransitionKind,
  update: () => void | Promise<void>,
  options: MotionTransitionOptions = {},
): boolean {
  const start = typeof document === 'undefined'
    ? undefined
    : (document as ViewTransitionDocument).startViewTransition;
  if (!motionEnabled() || typeof start !== 'function') {
    const previous = active;
    active = null;
    if (previous) {
      previous.supersede();
      generation[previous.kind] += 1;
      previous.cleanup();
    }
    const stranded = pendingUpdate;
    pendingUpdate = null;
    void runPendingUpdate(stranded, update);
    return false;
  }

  const previous = active;
  active = null;
  previous?.supersede();
  const carried = pendingUpdate;
  pendingUpdate = null;

  generation[kind] += 1;
  const token = generation[kind];
  const root = document.documentElement;

  let executed = false;
  const execute = (): void | Promise<void> => {
    if (executed) return undefined;
    executed = true;
    return runPendingUpdate(carried, update);
  };

  let transition: ViewTransitionLike;
  try {
    options.prepare?.();
    root.dataset.viewTransition = kind;
    transition = start.call(document, execute);
  } catch {
    if (root.dataset.viewTransition === kind) delete root.dataset.viewTransition;
    options.cleanup?.();
    if (!executed) void runPendingUpdate(carried, update);
    return false;
  }

  const cleanup = () => {
    if (root.dataset.viewTransition === kind) delete root.dataset.viewTransition;
    options.cleanup?.();
  };
  const entry: ActiveTransition = {
    kind,
    supersede: () => {
      transition.skipTransition?.();
      if (!executed) pendingUpdate = execute;
    },
    cleanup,
  };
  active = entry;

  const finish = () => {
    if (active === entry) active = null;
    if (token !== generation[kind]) return;
    entry.cleanup();
  };
  void transition.finished.then(finish, finish);
  return true;
}

export function runViewTransition(update: () => void): void {
  runMotionTransition('view', update);
}

export function animateMenuEntrance(element: HTMLElement): () => void {
  if (!motionEnabled() || typeof element.animate !== 'function') return () => undefined;

  const root = document.documentElement;
  const controls = animate(
    element,
    { opacity: [0, 1], transform: ['translateY(-4px) scale(0.985)', 'translateY(0) scale(1)'] },
    { duration: 0.14, ease: 'easeOut' },
  );
  const reset = () => {
    controls.stop();
    element.style.removeProperty('transform');
    element.style.removeProperty('opacity');
  };
  const handleMotionChange = () => {
    if (!motionEnabled()) reset();
  };

  root.addEventListener('obsidium-motion-change', handleMotionChange);
  return () => {
    root.removeEventListener('obsidium-motion-change', handleMotionChange);
    reset();
  };
}
