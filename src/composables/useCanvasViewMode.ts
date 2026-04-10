// Composable for the canvas view mode (single / stack / files):
// owns the reactive ref, persists to localStorage, hooks the
// "refresh files tree after each agent run" side effect, and
// exposes the Cmd/Ctrl+1/2/3 keydown handler. The pure parsing
// helpers live in src/utils/canvas/viewMode.ts so the rules are
// unit-testable.

import { ref, watch, type ComputedRef, type Ref } from "vue";
import {
  type CanvasViewMode,
  VIEW_MODE_STORAGE_KEY,
  parseStoredViewMode,
  viewModeForShortcutKey,
} from "../utils/canvas/viewMode";

interface UseCanvasViewModeOptions {
  // Watched so the file tree can be refreshed when the agent run
  // ends — newly written files appear without a manual reload.
  isRunning: ComputedRef<boolean> | Ref<boolean>;
}

export function useCanvasViewMode(opts: UseCanvasViewModeOptions): {
  canvasViewMode: Ref<CanvasViewMode>;
  setCanvasViewMode: (mode: CanvasViewMode) => void;
  filesRefreshToken: Ref<number>;
  handleViewModeShortcut: (e: KeyboardEvent) => void;
} {
  const canvasViewMode = ref<CanvasViewMode>(
    parseStoredViewMode(localStorage.getItem(VIEW_MODE_STORAGE_KEY)),
  );
  const filesRefreshToken = ref(0);

  function setCanvasViewMode(mode: CanvasViewMode): void {
    canvasViewMode.value = mode;
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
  }

  // After each run completes, bump filesRefreshToken so any open
  // FilesView re-fetches the workspace tree.
  watch(opts.isRunning, (running, prev) => {
    if (prev && !running) {
      filesRefreshToken.value++;
    }
  });

  function handleViewModeShortcut(e: KeyboardEvent): void {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.altKey || e.shiftKey) return;
    const target = viewModeForShortcutKey(e.key);
    if (target === null) return;
    setCanvasViewMode(target);
    e.preventDefault();
  }

  return {
    canvasViewMode,
    setCanvasViewMode,
    filesRefreshToken,
    handleViewModeShortcut,
  };
}
