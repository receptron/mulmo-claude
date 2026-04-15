# Fix: persist file tree expand/collapse state across reloads

## Problem

`src/components/FileTree.vue:74` defines per-instance state:

```ts
const expanded = ref(props.node.path === "");
```

Each `FileTree` component creates its own `expanded` ref, which is lost on every remount. This includes:

- Page reload
- Re-fetching the workspace tree (`filesRefreshToken` bumps after each agent run — see `src/composables/useCanvasViewMode.ts:40-44`)
- Toggling Files mode off/on

Result: every meaningful interaction with the agent collapses every directory the user just opened. Annoying when working inside a deep workspace.

## Goal

Persist the set of expanded directory paths to `localStorage`, restore on mount. Default behavior unchanged on first run (only the workspace root is expanded).

## Non-goals

- **Not** persisting selected file path (already done — `STORAGE_KEY = "files_selected_path"` in `FilesView.vue:210,422`).
- **Not** pruning stale paths (deleted dirs). Cheap to leave them; pruning would require diffing the tree on every fetch.
- **Not** scoping per-workspace. Single global `localStorage` namespace is fine for now — the workspace root is always `""` so paths are workspace-relative. If users start juggling multiple workspaces in the same browser this can be revisited.
- **Not** introducing a state library (Pinia, Vuex). Module-level reactive state is enough.

## Design

Follow the established `useCanvasViewMode` pattern:

1. **Pure helpers** (`src/utils/files/expandedDirs.ts`) — JSON parsing / serialization, fully unit-testable, no Vue imports.
2. **Composable** (`src/composables/useExpandedDirs.ts`) — module-level singleton `Set<string>` ref + `watch` for `localStorage` persistence + `isExpanded(path)` / `toggle(path)` API.
3. **FileTree.vue** — replace local `expanded` ref with composable.

### Why module-level singleton

`FileTree` is recursive: every directory mounts its own component instance. They all need to read/write the **same** set. Options:

- **provide/inject**: works but adds boilerplate at the FilesView root and a inject in every FileTree.
- **Prop + emit + parent owns the Set**: parent must replace the Set on every toggle (Set's mutations aren't deeply reactive in Vue). Boilerplate at every recursion level.
- **Module-level reactive ref**: defined once at module scope, all instances import it directly. Simplest. Vue 3 idiomatic for app-wide singleton state without a full store.

Going with the module-level approach.

### Pure helpers — `src/utils/files/expandedDirs.ts`

```ts
export const EXPANDED_DIRS_STORAGE_KEY = "files_expanded_dirs";

// Default: only the workspace root is expanded — matches the
// pre-persistence behavior of FileTree.vue.
const DEFAULT_EXPANDED: ReadonlyArray<string> = [""];

export function parseStoredExpandedDirs(raw: string | null): Set<string> {
  if (raw === null) return new Set(DEFAULT_EXPANDED);
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set(DEFAULT_EXPANDED);
    const strings = parsed.filter((v): v is string => typeof v === "string");
    return new Set(strings);
  } catch {
    return new Set(DEFAULT_EXPANDED);
  }
}

export function serializeExpandedDirs(set: Set<string>): string {
  return JSON.stringify([...set]);
}
```

Notes:
- `raw === null` → first run, return default. Distinguished from `raw === "[]"` (user collapsed everything intentionally).
- Filters non-string entries instead of rejecting the whole array — graceful degradation if something corrupted localStorage.
- Catches JSON parse errors → fallback to default.

### Composable — `src/composables/useExpandedDirs.ts`

```ts
import { ref, watch } from "vue";
import {
  EXPANDED_DIRS_STORAGE_KEY,
  parseStoredExpandedDirs,
  serializeExpandedDirs,
} from "../utils/files/expandedDirs";

// Module-level singleton: every FileTree instance shares the same
// Set. Initialized once on first import.
const expandedDirs = ref<Set<string>>(
  parseStoredExpandedDirs(
    typeof localStorage !== "undefined"
      ? localStorage.getItem(EXPANDED_DIRS_STORAGE_KEY)
      : null,
  ),
);

watch(
  expandedDirs,
  (val) => {
    try {
      localStorage.setItem(EXPANDED_DIRS_STORAGE_KEY, serializeExpandedDirs(val));
    } catch {
      // localStorage may be disabled (private mode); ignore.
    }
  },
);

export function useExpandedDirs(): {
  isExpanded: (path: string) => boolean;
  toggle: (path: string) => void;
} {
  function isExpanded(path: string): boolean {
    return expandedDirs.value.has(path);
  }
  function toggle(path: string): void {
    // Replace the Set so the watch fires (Set mutations aren't
    // tracked by Vue's reactivity).
    const next = new Set(expandedDirs.value);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    expandedDirs.value = next;
  }
  return { isExpanded, toggle };
}
```

### FileTree.vue change

```diff
-import { ref, computed } from "vue";
+import { computed } from "vue";
+import { useExpandedDirs } from "../composables/useExpandedDirs";
@@
-const expanded = ref(props.node.path === "");
+const { isExpanded, toggle } = useExpandedDirs();
+const expanded = computed(() => isExpanded(props.node.path));

 const isRecent = computed(() => props.recentPaths.has(props.node.path));
```

And in template:

```diff
-      @click="expanded = !expanded"
+      @click="toggle(node.path)"
```

## Tests

`test/utils/files/test_expandedDirs.ts` — pure helpers only:

- `parseStoredExpandedDirs`:
  - `null` → default `Set([""])`
  - empty string `""` → default (JSON parse fails)
  - invalid JSON `"{not json"` → default
  - non-array JSON `'"hello"'` / `'42'` / `'{}'` → default
  - empty array `"[]"` → empty Set (intentional collapse-all)
  - happy path `'["", "src", "src/components"]'` → Set with 3 entries
  - mixed types `'["", 42, "src", null]'` → filters to `Set(["", "src"])`
- `serializeExpandedDirs`:
  - empty Set → `"[]"`
  - populated Set → JSON array of strings
- Roundtrip: serialize → parse → equal Set

The composable itself has minimal logic on top of the pure helpers; testing it would require jsdom + reactivity setup, not worth the cost.

## Manual smoke test

1. `yarn dev`, open Files mode
2. Expand a few nested dirs
3. Reload page → expanded state restored
4. Run a chat turn → tree refetches → expanded state still preserved (this is the main bug being fixed)
5. Toggle Files mode off and back on → expanded state preserved
6. Open devtools → Application → Local Storage → verify `files_expanded_dirs` key contains the expected JSON array
7. Manually corrupt the localStorage value (`"garbage"`) → reload → app doesn't crash, falls back to default

## Risk assessment

- **Set grows unbounded over months of use** → in practice bounded by total dirs in the workspace (hundreds, not millions). Acceptable.
- **Stale paths after dir rename/delete** → harmless; the path simply never matches a node again. No prune logic needed.
- **Multiple workspaces sharing the same browser** → all share one localStorage key. Edge case, can revisit if it becomes a real problem.
- **localStorage disabled (private mode)** → composable catches the error, runs in-memory only. State still works within a session, just doesn't persist.
