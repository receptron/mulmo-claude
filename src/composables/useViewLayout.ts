// View-layout state. Derives two values that the template cares about:
//
//  - isStackLayout: true whenever the canvas column should be full-width
//    (no sidebar). This is the case for /chat in stack mode AND for
//    every non-chat page (/files, /todos, /wiki, etc.). Only /chat in
//    single mode shows the left sidebar.
//
//  - displayedCurrentSessionId: blank on non-chat pages so no session
//    tab appears "current" while the user is on Files, Todos, etc.
//
// Also flips activePane between "sidebar" and "main" so arrow-key
// navigation follows whichever side of the layout is visible.

import { computed, watch, type ComputedRef, type Ref } from "vue";
import { LAYOUT_MODES, type LayoutMode } from "../utils/canvas/layoutMode";

export function useViewLayout(opts: {
  layoutMode: Ref<LayoutMode> | ComputedRef<LayoutMode>;
  isChatPage: Ref<boolean> | ComputedRef<boolean>;
  currentSessionId: Ref<string>;
  activePane: Ref<"sidebar" | "main">;
}) {
  const { layoutMode, isChatPage, currentSessionId, activePane } = opts;

  const isStackLayout = computed(() => !(isChatPage.value && layoutMode.value === LAYOUT_MODES.single));

  const displayedCurrentSessionId = computed(() => (isChatPage.value ? currentSessionId.value : ""));

  watch(
    isStackLayout,
    (stack) => {
      activePane.value = stack ? "main" : "sidebar";
    },
    { immediate: true },
  );

  return {
    isStackLayout,
    displayedCurrentSessionId,
  };
}
