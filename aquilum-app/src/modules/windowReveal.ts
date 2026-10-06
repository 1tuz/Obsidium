import { getCurrentWindow } from '@tauri-apps/api/window';

let started = false;

export function revealAppWindow(): void {
  if (started) return;
  started = true;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void getCurrentWindow()
        .show()
        .catch((error) => console.error('Failed to reveal app window', error))
        .finally(() => document.documentElement.classList.add('q-window-revealed'));
    });
  });
}
