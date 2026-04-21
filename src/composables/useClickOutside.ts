// Composable that builds a `mousedown` handler which closes a
// boolean ref (`isOpen`) when the click happened outside both the
// trigger button and the popup body. Three popups in App.vue
// (history, sandbox lock, role dropdown) all share this exact
// pattern.

import type { Ref } from "vue";
import { isClickOutside } from "../utils/dom/clickOutside";

interface UseClickOutsideOptions {
  isOpen: Ref<boolean>;
  buttonRef: Ref<HTMLElement | null>;
  popupRef: Ref<HTMLElement | null>;
}

export function useClickOutside(opts: UseClickOutsideOptions): {
  handler: (e: MouseEvent) => void;
} {
  function handler(event: MouseEvent): void {
    if (!opts.isOpen.value) return;
    if (isClickOutside(event.target as Node | null, opts.buttonRef.value, opts.popupRef.value)) {
      opts.isOpen.value = false;
    }
  }
  return { handler };
}
