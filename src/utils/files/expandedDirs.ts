// Pure helpers for persisting the FileTree expand/collapse state.
// Kept Vue-free so the parsing rules are unit-testable in isolation.

export const EXPANDED_DIRS_STORAGE_KEY = "files_expanded_dirs";

// Default: only the workspace root ("") is expanded — matches the
// pre-persistence behavior of FileTree.vue, where nested dirs start
// collapsed so opening Files mode doesn't render the whole tree.
const DEFAULT_EXPANDED: readonly string[] = [""];

export function parseStoredExpandedDirs(raw: string | null): Set<string> {
  if (raw === null) return new Set(DEFAULT_EXPANDED);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_EXPANDED);
    const strings = parsed.filter((val): val is string => typeof val === "string");
    return new Set(strings);
  } catch {
    return new Set(DEFAULT_EXPANDED);
  }
}

export function serializeExpandedDirs(set: Set<string>): string {
  return JSON.stringify([...set]);
}
