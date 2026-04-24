// Composable that wires the window-level event listeners used by
// App.vue (global keydown for arrow-key navigation / Esc) and tears
// them down on unmount.
//
// Plugin → App.vue communication used to live here too via
// `roles-updated` / `skill-run` CustomEvents on `window`. That now
// flows through `useAppApi` (provide/inject) — see #227. Anything
// remaining in this composable is genuinely a window-level concern
// (keyboard events that don't have a single "owning" component).
//
// The click-outside handler for the history popup was dropped when
// the popup became a real page at /history (see
// plans/feat-history-url-route.md).
//
// Each listener is supplied as an option so the composable stays
// independent of App.vue's local state; the caller passes the
// already-bound handlers.

import { onMounted, onUnmounted } from "vue";

export interface EventListenerHandlers {
  /** Global keydown for arrow-key navigation / Esc handling. */
  onKeyNavigation: (e: KeyboardEvent) => void;
  /** Called in onUnmounted after all window listeners are removed. */
  onTeardown?: () => void;
}

export function useEventListeners(handlers: EventListenerHandlers): void {
  onMounted(() => {
    window.addEventListener("keydown", handlers.onKeyNavigation);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", handlers.onKeyNavigation);
    handlers.onTeardown?.();
  });
}
