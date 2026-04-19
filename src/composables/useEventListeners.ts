// Composable that wires the window-level event listeners used by
// App.vue (click-outside handlers for 3 popups + global keydown for
// navigation + view-mode shortcuts) and tears them down on unmount.
//
// Plugin → App.vue communication used to live here too via
// `roles-updated` / `skill-run` CustomEvents on `window`. That now
// flows through `useAppApi` (provide/inject) — see #227. Anything
// remaining in this composable is genuinely a window-level concern
// (keyboard / mouse events that don't have a single "owning"
// component).
//
// Each listener is supplied as an option so the composable stays
// independent of App.vue's local state; the caller passes the
// already-bound handlers.

import { onMounted, onUnmounted } from "vue";

export interface EventListenerHandlers {
  /** Global keydown for arrow-key navigation / Esc handling. */
  onKeyNavigation: (e: KeyboardEvent) => void;
  /** Global keydown for Cmd/Ctrl+1/2/3 view-mode shortcut. */
  onViewModeShortcut: (e: KeyboardEvent) => void;
  /** mousedown click-outside handlers for each popup. */
  onClickOutsideHistory: (e: MouseEvent) => void;
  onClickOutsideLock: (e: MouseEvent) => void;
  onClickOutsideRoleDropdown: (e: MouseEvent) => void;
  /** Called in onUnmounted after all window listeners are removed. */
  onTeardown?: () => void;
}

export function useEventListeners(handlers: EventListenerHandlers): void {
  onMounted(() => {
    window.addEventListener("keydown", handlers.onKeyNavigation);
    window.addEventListener("keydown", handlers.onViewModeShortcut);
    window.addEventListener("mousedown", handlers.onClickOutsideHistory);
    window.addEventListener("mousedown", handlers.onClickOutsideLock);
    window.addEventListener("mousedown", handlers.onClickOutsideRoleDropdown);
  });

  onUnmounted(() => {
    window.removeEventListener("keydown", handlers.onKeyNavigation);
    window.removeEventListener("keydown", handlers.onViewModeShortcut);
    window.removeEventListener("mousedown", handlers.onClickOutsideHistory);
    window.removeEventListener("mousedown", handlers.onClickOutsideLock);
    window.removeEventListener(
      "mousedown",
      handlers.onClickOutsideRoleDropdown,
    );
    handlers.onTeardown?.();
  });
}
