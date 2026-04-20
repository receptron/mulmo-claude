// Pure helpers for the canvas view mode.
// The type also lives here, so test files and composables can
// import it without pulling in a .vue file.
//
// To add a new view mode, add it to CANVAS_VIEW below in shortcut order.
// Everything else (type, set, parser, shortcut) derives automatically.

export const CANVAS_VIEW = {
  single: "single",
  stack: "stack",
  files: "files",
  todos: "todos",
  scheduler: "scheduler",
  wiki: "wiki",
  skills: "skills",
  roles: "roles",
} as const;

const VIEW_MODES = Object.values(CANVAS_VIEW);

export type CanvasViewMode = (typeof CANVAS_VIEW)[keyof typeof CANVAS_VIEW];

export function isCanvasViewMode(value: string): value is CanvasViewMode {
  return (VIEW_MODES as readonly string[]).includes(value);
}

/** All valid view mode values — single source of truth for guards and parsers. */
export const VALID_VIEW_MODES: ReadonlySet<string> = new Set(VIEW_MODES);

export const VIEW_MODE_STORAGE_KEY = "canvas_view_mode";

// Parse a value pulled out of localStorage. Anything other than the
// known modes — including null — falls back to "single".
export function parseStoredViewMode(stored: string | null): CanvasViewMode {
  if (typeof stored === "string" && isCanvasViewMode(stored)) {
    return stored;
  }
  return CANVAS_VIEW.single;
}

// Map a Cmd/Ctrl + N keyboard shortcut digit to its view mode.
// Shortcut keys are 1-indexed into the VIEW_MODES array.
export function viewModeForShortcutKey(key: string): CanvasViewMode | null {
  const index = Number(key) - 1;
  return VIEW_MODES[index] ?? null;
}
