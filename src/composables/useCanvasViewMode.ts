// Composable for the canvas view mode values defined in
// src/utils/canvas/viewMode.ts:
// owns the reactive ref, syncs to the URL via vue-router, persists
// to localStorage as fallback, hooks the "refresh files tree after
// each agent run" side effect, and exposes the Cmd/Ctrl+digit
// keydown handler. The pure parsing helpers live in
// src/utils/canvas/viewMode.ts so the rules are unit-testable.

import { ref, watch, type ComputedRef, type Ref } from "vue";
import { useRoute, useRouter, isNavigationFailure } from "vue-router";
import {
  type CanvasViewMode,
  CANVAS_VIEW,
  VIEW_MODE_STORAGE_KEY,
  parseStoredViewMode,
  viewModeForShortcutKey,
} from "../utils/canvas/viewMode";
import type { LocationQuery } from "vue-router";

interface UseCanvasViewModeOptions {
  // Watched so the file tree can be refreshed when the agent run
  // ends — newly written files appear without a manual reload.
  isRunning: ComputedRef<boolean> | Ref<boolean>;
}

/**
 * Build a query object that reflects the given view mode.
 * "single" (the default) omits `?view=` for cleaner URLs;
 * other modes set it explicitly.
 */
function applyViewToQuery(
  currentQuery: LocationQuery,
  mode: CanvasViewMode,
): LocationQuery {
  const rest: LocationQuery = { ...currentQuery };
  delete rest.view;
  // Remove ?path= when leaving the files view — it's only meaningful
  // in files mode and would cause a stale file selection on reload.
  if (mode !== CANVAS_VIEW.files) delete rest.path;
  if (mode === CANVAS_VIEW.single) return rest;
  return { ...rest, view: mode };
}

export function useCanvasViewMode(opts: UseCanvasViewModeOptions): {
  canvasViewMode: Ref<CanvasViewMode>;
  setCanvasViewMode: (mode: CanvasViewMode) => void;
  buildViewQuery: () => LocationQuery;
  filesRefreshToken: Ref<number>;
  handleViewModeShortcut: (e: KeyboardEvent) => void;
} {
  const route = useRoute();
  const router = useRouter();

  // Initialise from URL if ?view= is present, otherwise fall back to
  // localStorage (the user's last-chosen mode), then to "single".
  const urlView =
    typeof route.query.view === "string" ? route.query.view : null;
  const canvasViewMode = ref<CanvasViewMode>(
    parseStoredViewMode(urlView ?? localStorage.getItem(VIEW_MODE_STORAGE_KEY)),
  );
  const filesRefreshToken = ref(0);

  function setCanvasViewMode(mode: CanvasViewMode): void {
    canvasViewMode.value = mode;
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    router
      .push({ query: applyViewToQuery(route.query, mode) })
      .catch((err: unknown) => {
        if (!isNavigationFailure(err)) {
          console.error("[setCanvasViewMode] navigation failed:", err);
        }
      });
  }

  /** Return a query object with the current view mode applied.
   *  Used by App.vue's navigateToSession so the URL always reflects
   *  the latest canvasViewMode.value (which may be more recent than
   *  route.query.view when setCanvasViewMode was just called). */
  function buildViewQuery(): LocationQuery {
    return applyViewToQuery(route.query, canvasViewMode.value);
  }

  // External URL changes (back/forward button, typed URL) → update ref.
  watch(
    () => route.query.view,
    (newView) => {
      const parsed = parseStoredViewMode(
        typeof newView === "string" ? newView : null,
      );
      if (parsed !== canvasViewMode.value) {
        canvasViewMode.value = parsed;
        localStorage.setItem(VIEW_MODE_STORAGE_KEY, parsed);
      }
    },
  );

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
    buildViewQuery,
    filesRefreshToken,
    handleViewModeShortcut,
  };
}
