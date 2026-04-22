// Pure helpers for the canvas layout mode.
//
// Layout is a user preference — single (sidebar + canvas) vs. stack
// (no sidebar, full-width canvas). It applies only to the /chat page
// and persists in localStorage.
//
// Pages like /files, /todos, /wiki, /skills, /roles, /scheduler are
// distinct routes, not layout variants. They live in the router, not
// here.

export const LAYOUT_MODES = {
  single: "single",
  stack: "stack",
} as const;

export type LayoutMode = (typeof LAYOUT_MODES)[keyof typeof LAYOUT_MODES];

export const LAYOUT_MODE_STORAGE_KEY = "canvas_layout_mode";

// Legacy key from before layout/page were split. Deleted on first
// read of useLayoutMode — not migrated (fresh start).
export const LEGACY_VIEW_MODE_STORAGE_KEY = "canvas_view_mode";

export function parseStoredLayoutMode(stored: string | null): LayoutMode {
  return stored === LAYOUT_MODES.stack ? LAYOUT_MODES.stack : LAYOUT_MODES.single;
}
