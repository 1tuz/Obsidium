export function transitionThemeFrom(element: HTMLElement, update: () => void | Promise<void>): void {
  const root = document.documentElement;
  if (root.dataset.motion !== 'on'
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || typeof (document as Document & { startViewTransition?: unknown }).startViewTransition !== 'function') {
    void update();
    return;
  }

  const rectangle = element.getBoundingClientRect();
  const x = rectangle.left + rectangle.width / 2;
  const y = rectangle.top + rectangle.height / 2;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );
  root.style.setProperty('--q-theme-transition-x', `${x}px`);
  root.style.setProperty('--q-theme-transition-y', `${y}px`);
  root.style.setProperty('--q-theme-transition-radius', `${radius}px`);

  const { startViewTransition } = document as Document & {
    startViewTransition: (callback: () => void | Promise<void>) => { finished: Promise<void> };
  };
  const transition = startViewTransition.call(document, update);
  const clearOrigin = () => {
    root.style.removeProperty('--q-theme-transition-x');
    root.style.removeProperty('--q-theme-transition-y');
    root.style.removeProperty('--q-theme-transition-radius');
  };
  void transition.finished.then(clearOrigin, clearOrigin);
}
