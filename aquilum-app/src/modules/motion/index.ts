import { animate } from 'motion/mini';
import { motionEnabled } from '../theme';

interface ViewTransitionLike {
  finished: Promise<unknown>;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => ViewTransitionLike;
};

export function runViewTransition(update: () => void): void {
  if (typeof document === 'undefined' || !motionEnabled()) {
    update();
    return;
  }

  const doc = document as ViewTransitionDocument;
  const start = doc.startViewTransition;
  if (typeof start !== 'function') {
    update();
    return;
  }

  let updated = false;
  const guardedUpdate = () => {
    updated = true;
    update();
  };

  try {
    const transition = start.call(doc, guardedUpdate);
    void transition.finished.catch(() => undefined);
  } catch {
    if (!updated) update();
  }
}

export function animateMenuEntrance(element: HTMLElement): () => void {
  if (!motionEnabled() || typeof element.animate !== 'function') return () => undefined;

  const controls = animate(
    element,
    { opacity: [0, 1], transform: ['translateY(-4px) scale(0.985)', 'translateY(0) scale(1)'] },
    { duration: 0.14, ease: 'easeOut' },
  );

  return () => controls.stop();
}
