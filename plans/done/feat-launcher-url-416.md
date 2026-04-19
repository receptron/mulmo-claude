# feat: Launcher URL reflection and landing restoration (#416)

## Problem

When a user clicks a launcher button (Todos, Scheduler, Wiki, Skills, Roles),
the URL doesn't reflect the state. Landing on a URL with those states doesn't
restore the view.

## Current state

- Files button → `?view=files` → landing works (FilesView mounts)
- Invoke buttons → API call → `?result=<uuid>` → landing fails if session not loaded
- PluginLauncher active highlight works via `activeToolName` match (only after invoke)

## Design: extend CanvasViewMode

Add `"todos" | "scheduler"` to CanvasViewMode. These are views that have their
own full-canvas component (like FilesView), not just a single ToolResult.

For Wiki, Skills, Roles — these remain `invoke` kind because they push a
ToolResult into the session. Their URL state is already captured via `?result=<uuid>`.

### Changes

1. **`src/utils/canvas/viewMode.ts`**
   - Add `"todos" | "scheduler"` to `CanvasViewMode` type
   - Derive from `as const` array (eliminate cast)
   - Export `isCanvasViewMode` type guard
   - Add shortcuts 4/5

2. **`src/components/TodoExplorer.vue`**
   - Make `selectedResult` prop optional (standalone mode)

3. **`src/App.vue`**
   - Add canvas branches for `todos` / `scheduler`
   - TodoExplorer renders standalone (fetches from API)
   - Scheduler placeholder div

4. **`src/components/PluginLauncher.vue`**
   - Change todos/scheduler to `kind: "view"` (not invoke)
   - `isActive` checks `activeViewMode` for view-kind targets

5. **`src/composables/useCanvasViewMode.ts`**
   - Update comment

6. **Tests**
   - Unit tests for new view modes
   - E2E: keyboard shortcuts (Cmd+4/5)
   - E2E: URL navigation (?view=todos, ?view=scheduler)
   - E2E: plugin-launcher button behavior updated

### What NOT to change

- Wiki / Skills / Roles remain `invoke` kind
- No changes to PluginLauncher's `onPluginNavigate` for invoke buttons
- No changes to `WORKSPACE_FILES` (done in #415)

### Risk mitigation (lessons from PR #414)

- DO NOT change existing `invoke` → `view` for files button (already works)
- DO NOT change `kind: "files"` — it's already correct
- Test every E2E suite that touches launcher buttons before committing
