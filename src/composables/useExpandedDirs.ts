// Composable for the FileTree expand/collapse state. Owns a
// module-level reactive Set so every recursive FileTree instance
// shares the same state, and persists changes to localStorage.
//
// The pure parsing helpers live in src/utils/files/expandedDirs.ts
// so the rules are unit-testable without a Vue runtime.

import { ref, watch, type Ref } from "vue";
import { EXPANDED_DIRS_STORAGE_KEY, parseStoredExpandedDirs, serializeExpandedDirs } from "../utils/files/expandedDirs";

function loadInitial(): Set<string> {
  if (typeof localStorage === "undefined") {
    return parseStoredExpandedDirs(null);
  }
  try {
    return parseStoredExpandedDirs(localStorage.getItem(EXPANDED_DIRS_STORAGE_KEY));
  } catch {
    return parseStoredExpandedDirs(null);
  }
}

// Module-level singleton: every FileTree instance imports this
// composable and reads/writes the same Set.
const expandedDirs: Ref<Set<string>> = ref(loadInitial());

watch(expandedDirs, (val) => {
  try {
    localStorage.setItem(EXPANDED_DIRS_STORAGE_KEY, serializeExpandedDirs(val));
  } catch {
    // localStorage may be disabled (private mode) or full; ignore
    // and keep the in-memory state working for this session.
  }
});

export function useExpandedDirs(): {
  isExpanded: (path: string) => boolean;
  toggle: (path: string) => void;
  expand: (path: string) => void;
  expandedPaths: () => string[];
} {
  function isExpanded(path: string): boolean {
    return expandedDirs.value.has(path);
  }
  function toggle(path: string): void {
    // Replace the Set so the watch fires — Set mutations aren't
    // tracked by Vue's reactivity.
    const next = new Set(expandedDirs.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expandedDirs.value = next;
  }
  // Idempotently mark a path as expanded (used by deep-link auto-
  // expand where we want to reveal ancestors without toggling).
  function expand(path: string): void {
    if (expandedDirs.value.has(path)) return;
    const next = new Set(expandedDirs.value);
    next.add(path);
    expandedDirs.value = next;
  }
  function expandedPaths(): string[] {
    return Array.from(expandedDirs.value);
  }
  return { isExpanded, toggle, expand, expandedPaths };
}
