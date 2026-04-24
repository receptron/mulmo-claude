// Layout preference (single vs. stack) for the /chat page, persisted
// in localStorage. Independent of which page the user is on — pages
// like Files/Todos/Wiki live in the router, not here.
//
// One-time cleanup: deletes the legacy `canvas_view_mode` key that
// conflated layout with page navigation. The value is intentionally
// not migrated — users land on "single" on first load after the
// split.

import { ref, type Ref } from "vue";
import { LAYOUT_MODE_STORAGE_KEY, LEGACY_VIEW_MODE_STORAGE_KEY, parseStoredLayoutMode, type LayoutMode } from "../utils/canvas/layoutMode";

export function useLayoutMode(): {
  layoutMode: Ref<LayoutMode>;
  setLayoutMode: (mode: LayoutMode) => void;
} {
  localStorage.removeItem(LEGACY_VIEW_MODE_STORAGE_KEY);

  const layoutMode = ref<LayoutMode>(parseStoredLayoutMode(localStorage.getItem(LAYOUT_MODE_STORAGE_KEY)));

  function setLayoutMode(mode: LayoutMode): void {
    layoutMode.value = mode;
    localStorage.setItem(LAYOUT_MODE_STORAGE_KEY, mode);
  }

  return { layoutMode, setLayoutMode };
}
