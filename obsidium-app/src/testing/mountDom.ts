import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';

export interface MountedDom {
  container: HTMLElement;
  update: (node: ComponentChild) => void;
  unmount: () => void;
}

if (typeof window !== 'undefined') {
  window.requestAnimationFrame = (callback: FrameRequestCallback): number => (
    window.setTimeout(() => callback(window.performance?.now?.() ?? Date.now()), 0)
  );
  window.cancelAnimationFrame = (handle: number): void => {
    window.clearTimeout(handle);
  };
}

export function mountDom(node: ComponentChild): MountedDom {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(node, container);
  return {
    container,
    update: (next) => render(next, container),
    unmount: () => {
      render(null, container);
      container.remove();
    },
  };
}

export async function actAndSettle(callback: () => void | Promise<void> = () => {}): Promise<void> {
  await act(callback);
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}
