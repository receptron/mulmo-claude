// Pure helpers for the canvas view mode.
// The type also lives here, so test files and composables can
// import it without pulling in a .vue file.

export type CanvasViewMode =
  | "single"
  | "stack"
  | "files"
  | "todos"
  | "scheduler";

/** All valid view mode values. Guards and parsers check against this. */
export const VALID_VIEW_MODES: ReadonlySet<string> = new Set<CanvasViewMode>([
  "single",
  "stack",
  "files",
  "todos",
  "scheduler",
]);

export const VIEW_MODE_STORAGE_KEY = "canvas_view_mode";

// Parse a value pulled out of localStorage. Anything other than the
// known modes — including null — falls back to "single".
export function parseStoredViewMode(stored: string | null): CanvasViewMode {
  if (typeof stored === "string" && VALID_VIEW_MODES.has(stored)) {
    return stored as CanvasViewMode;
  }
  return "single";
}

// Map a Cmd/Ctrl + N keyboard shortcut digit to its view mode.
// Returns null when the key is not a known shortcut.
export function viewModeForShortcutKey(key: string): CanvasViewMode | null {
  if (key === "1") return "single";
  if (key === "2") return "stack";
  if (key === "3") return "files";
  if (key === "4") return "todos";
  if (key === "5") return "scheduler";
  return null;
}
