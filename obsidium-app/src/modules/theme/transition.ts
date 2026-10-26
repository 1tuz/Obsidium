import { runMotionTransition } from '../motion';

const TRANSITION_VARIABLES = [
  '--q-theme-transition-x',
  '--q-theme-transition-y',
  '--q-theme-transition-radius',
] as const;

export function transitionThemeFrom(element: HTMLElement, update: () => void | Promise<void>): void {
  const root = document.documentElement;
  runMotionTransition('theme', update, {
    prepare: () => {
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
    },
    cleanup: () => {
      for (const name of TRANSITION_VARIABLES) root.style.removeProperty(name);
    },
  });
}
