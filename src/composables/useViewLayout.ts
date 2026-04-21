// View-layout state: tracks whether the app is in a "stack" layout
// (full-width canvas) or "single" (sidebar + canvas), remembers the
// last chat-oriented view mode, and derives displayedCurrentSessionId
// (blank in plugin views so no tab appears "current").

import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { CANVAS_VIEW, type CanvasViewMode } from "../utils/canvas/viewMode";

const CHAT_VIEWS = [CANVAS_VIEW.single, CANVAS_VIEW.stack] as const;
type ChatViewMode = (typeof CHAT_VIEWS)[number];

function isChatView(mode: string): mode is ChatViewMode {
  return (CHAT_VIEWS as readonly string[]).includes(mode);
}

export function useViewLayout(opts: {
  canvasViewMode: Ref<CanvasViewMode> | ComputedRef<CanvasViewMode>;
  setCanvasViewMode: (mode: CanvasViewMode) => void;
  currentSessionId: Ref<string>;
  activePane: Ref<"sidebar" | "main">;
}) {
  const { canvasViewMode, setCanvasViewMode, currentSessionId, activePane } = opts;

  const isStackLayout = computed(() => canvasViewMode.value !== CANVAS_VIEW.single);

  const lastChatViewMode = ref<ChatViewMode>(isChatView(canvasViewMode.value) ? canvasViewMode.value : CANVAS_VIEW.stack);

  watch(canvasViewMode, (mode) => {
    if (isChatView(mode)) lastChatViewMode.value = mode;
  });

  function restoreChatViewForSession(): void {
    if (!isChatView(canvasViewMode.value)) {
      setCanvasViewMode(lastChatViewMode.value);
    }
  }

  const displayedCurrentSessionId = computed(() => (isChatView(canvasViewMode.value) ? currentSessionId.value : ""));

  // Keep arrow-key navigation tied to the canvas when the sidebar
  // list doesn't exist (Stack layout has no ToolResultsPanel).
  watch(
    isStackLayout,
    (stack) => {
      activePane.value = stack ? "main" : "sidebar";
    },
    { immediate: true },
  );

  return {
    isStackLayout,
    restoreChatViewForSession,
    displayedCurrentSessionId,
  };
}
