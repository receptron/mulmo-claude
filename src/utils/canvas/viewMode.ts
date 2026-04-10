// Pure helpers for the canvas view mode (single / stack / files).
// The type also lives here, so test files and composables can
// import it without pulling in a .vue file.

export type CanvasViewMode = "single" | "stack" | "files";

export const VIEW_MODE_STORAGE_KEY = "canvas_view_mode";

// Parse a value pulled out of localStorage. Anything other than the
// three known modes — including null — falls back to "single".
export function parseStoredViewMode(stored: string | null): CanvasViewMode {
  if (stored === "single" || stored === "stack" || stored === "files") {
    return stored;
  }
  return "single";
}

// Map a Cmd/Ctrl + N keyboard shortcut digit to its view mode.
// Returns null when the key is not one of the three shortcuts.
export function viewModeForShortcutKey(key: string): CanvasViewMode | null {
  if (key === "1") return "single";
  if (key === "2") return "stack";
  if (key === "3") return "files";
  return null;
}
