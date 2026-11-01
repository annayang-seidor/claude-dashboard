import { useSyncExternalStore } from 'react';

/** Phone width; the same breakpoint as the `@media` blocks in shell.css and list.css. */
export const NARROW_QUERY = '(max-width: 600px)';

// jsdom has no matchMedia; tests then get the desktop layout.
const media = () =>
  typeof window.matchMedia === 'function' ? window.matchMedia(NARROW_QUERY) : null;

/** True while the window is phone width, for what CSS cannot change (e.g. a placeholder). */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = media();
      m?.addEventListener('change', onChange);
      return () => m?.removeEventListener('change', onChange);
    },
    () => media()?.matches ?? false,
  );
}
