# Canvas View Modes

## Goal

Add a view-mode toggle to the central canvas in `src/App.vue` so the user is no longer limited to seeing one tool result at a time. Two new modes are introduced alongside the current single-result view:

1. **Stack mode** — render every tool result in the current session vertically as a scrollable timeline
2. **Files mode** — browse the workspace (`~/mulmoclaude`) directly in the browser

> **Status:** Design only — not to be implemented yet. This file captures the agreed scope so a future session can pick it up.

## Current State

- Canvas (`src/App.vue:228-253`) renders **only `selectedResult`** via the plugin's `viewComponent`
- The user must click each entry in the left sidebar (`src/App.vue:121-144`) to bring its content into the canvas
- `toolResults` already contains every entry (plugin results + `text-response` user/assistant messages)
- Workspace is `~/mulmoclaude` (`server/workspace/workspace.ts:10`) — already a git repo, with subdirs `chat`, `todos`, `calendar`, `contacts`, `scheduler`, `roles`, `stories`, plus `memory.md` and `helps/`
- There is no existing endpoint that lists or serves arbitrary workspace files

## Design

### View Modes

Three modes selectable from a toggle group in the **canvas top-right** corner:

| Mode | Icon | Behavior |
|---|---|---|
| `single` | `view_agenda` | Current behavior — show only `selectedResult` |
| `stack` | `view_stream` | Show every `toolResult` stacked vertically with headers |
| `files` | `folder` | Workspace file browser |

State held as `canvasViewMode: "single" \| "stack" \| "files"` in `App.vue`, persisted to `localStorage` (key `canvas_view_mode`) so reloads keep the chosen mode.

### Decisions (from clarification round)

- **a) What to include in stack mode** — **all** `toolResults`, including `text-response`. Reason: text-response has its own `viewComponent` (`src/plugins/textResponse/View.vue`) that renders Markdown nicely, and it's the only place the user can read the full assistant text (the sidebar just shows the "You"/"Assistant" label).
- **b) Per-item header in stack mode** — **yes**. Each item gets a small sticky-ish header showing tool name and title, so the user can tell what they're looking at as they scroll.
- **c) Toggle location** — **canvas top-right**, floating over the content (not in the sidebar).
- **d) Item height in stack mode** — **natural height**. Each `viewComponent` is rendered at whatever height it wants; the canvas itself becomes the single scroll container. Long components (e.g. a long Markdown answer) stay long; the user scrolls vertically through everything.

### Stack Mode Layout

```text
┌─ Canvas ─────────────────────────────────┐
│                          [single|stack|files] │  ← floating toggle, top-right
│ ┌─ Header: "You" (text-response) ──┐    │
│ │ <markdown rendered text>          │    │
│ └───────────────────────────────────┘    │
│ ┌─ Header: "Assistant" ─────────────┐    │
│ │ <markdown rendered text>          │    │
│ └───────────────────────────────────┘    │
│ ┌─ Header: "todoList" ──────────────┐    │
│ │ <TodoList View at natural height> │    │
│ └───────────────────────────────────┘    │
│ ┌─ Header: "generateImage" ─────────┐    │
│ │ <Image View at natural height>    │    │
│ └───────────────────────────────────┘    │
│                ↕ scrollable               │
└──────────────────────────────────────────┘
```

- Each item is wrapped in a card-like container with a 1-line header (`title || toolName`, plus a small icon if available)
- Clicking an item's header sets `selectedResultUuid` (so switching back to `single` mode lands on the same item)
- The currently-selected item is highlighted with a thin ring on its card border
- When the sidebar selection changes, the canvas scrolls the matching card into view

### Files Mode Layout

Two-pane split inside the canvas:

```text
┌─ Canvas ─────────────────────────────────┐
│                          [single|stack|files] │
│ ┌─ Tree ────┐ ┌─ Content ────────────┐  │
│ │ memory.md │ │ # Memory             │  │
│ │ chat/     │ │                      │  │
│ │  ▸ ...    │ │ Distilled facts...   │  │
│ │ todos/    │ │                      │  │
│ │  ▸ ...    │ │                      │  │
│ │ scheduler/│ │                      │  │
│ │  ▸ ...    │ │                      │  │
│ └───────────┘ └──────────────────────┘  │
└──────────────────────────────────────────┘
```

- **Left pane** (~280px): collapsible directory tree rooted at `~/mulmoclaude`
- **Right pane**: content of the selected file
- Read-only initially (no editing). Editing is out of scope.
- Selected file path persisted to `localStorage` (key `files_selected_path`) so reloads return to the same file.

#### File rendering rules

| Extension | Renderer |
|---|---|
| `.md`, `.markdown` | Markdown (reuse `@gui-chat-plugin/text-response/vue` if convenient) |
| `.json` | Pretty-printed in `<pre>` |
| `.yaml`, `.yml` | Plain `<pre>` |
| `.txt`, no extension | Plain `<pre>` |
| `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp` | `<img>` |
| `.pdf` | `<iframe>` or "Open in new tab" link |
| anything else | "Binary or unsupported — N bytes" placeholder |

#### Hidden files / dirs

- **Hide** `.git/` always
- **Show** other dotfiles/dotdirs but render them dimmed
- **Skip** files larger than 1 MB (show size + "too large to preview")

#### Path safety (server)

All file routes MUST resolve the requested path inside `workspacePath` and reject anything outside. Both endpoints must use **realpath-based** containment checks to defeat symlink escapes — `path.resolve` + `startsWith` alone is not enough because a symlink inside the workspace could point at `/etc/passwd`:

```typescript
const workspaceReal = fs.realpathSync(workspacePath);
const resolved = path.resolve(workspaceReal, requestedPath);
let resolvedReal: string;
try {
  resolvedReal = fs.realpathSync(resolved);
} catch {
  return res.status(404).json({ error: "Not found" });
}
if (
  resolvedReal !== workspaceReal &&
  !resolvedReal.startsWith(workspaceReal + path.sep)
) {
  return res.status(400).json({ error: "Path outside workspace" });
}
```

Tree building also skips any symlinked directory entries entirely as defense-in-depth.

## Implementation Plan

### Phase 1 — viewMode infrastructure + stack mode

1. **`src/App.vue`** — add `canvasViewMode` ref, `localStorage` persistence, toggle buttons floating in canvas top-right
2. **`src/components/CanvasViewToggle.vue`** *(new, optional)* — small 3-button toggle component, kept tiny so it can also live inline
3. **`src/components/StackView.vue`** *(new)* — receives `toolResults`, `selectedResultUuid`, emits `select`. Renders each result wrapped in a `StackItem` with a header
4. Wire up sidebar → stack auto-scroll: when `selectedResultUuid` changes and mode is `stack`, `scrollIntoView({ block: "nearest" })` on the matching card
5. Update `handleCanvasKeydown` so Up/Down arrows scroll the stack container (not just `findScrollableChild`)

### Phase 2 — files mode (server)

1. **`server/api/routes/files.ts`** *(new)*
   - `GET /api/files/tree` → recursive directory listing as a nested tree, hides `.git`
   - `GET /api/files/content?path=<rel>` → returns file content with `Content-Type` based on extension; binary files return raw bytes; JSON metadata for "too large" or "unsupported" cases
   - Both endpoints validate the path is inside `workspacePath`
2. **`server/index.ts`** — register `filesRoutes` under `/api`

### Phase 3 — files mode (client)

1. **`src/components/FilesView.vue`** *(new)* — two-pane layout, fetches tree on mount, fetches file content on selection. Handles all rendering rules from the table above.
2. **`src/components/FileTree.vue`** *(new)* — recursive tree component with collapse/expand, click to select
3. **`src/App.vue`** — render `<FilesView />` when `canvasViewMode === "files"`
4. Persist selected file path to `localStorage`

### Phase 4 — polish

1. Auto-refresh the file tree when the agent finishes a run (via the existing SSE flow — refresh on `isRunning` going false), so newly-written files appear without a manual reload
2. Show a small "modified Xs ago" indicator next to recently-changed files (last 60s)
3. Keyboard shortcuts: `Cmd/Ctrl+1/2/3` to switch view modes

## Files Changed

| File | Change |
|---|---|
| `src/App.vue` | Add `canvasViewMode` state, toggle UI, conditional rendering of single/stack/files |
| `src/components/CanvasViewToggle.vue` *(new)* | 3-button toggle |
| `src/components/StackView.vue` *(new)* | Vertical stack of all tool results |
| `src/components/FilesView.vue` *(new)* | Two-pane file browser |
| `src/components/FileTree.vue` *(new)* | Recursive directory tree |
| `server/api/routes/files.ts` *(new)* | `/api/files/tree` and `/api/files/content` |
| `server/index.ts` | Register `filesRoutes` |

## Out of Scope

- **Editing files** in the browser — read-only first cut
- **File upload / drag-and-drop** into the workspace
- **Search across files** — workspace-wide grep
- **Git status / diff view** — even though the workspace is a git repo
- **Watching files for live updates** (use the after-run refresh from Phase 4 instead)
- **Multi-file tabs** in files mode — single file at a time
- **Per-plugin custom stack rendering** — every plugin uses its existing `viewComponent` as-is

## Open Questions for Future Implementation

- Should `text-response` items in stack mode get a different visual treatment than plugin cards (e.g. no border, like a chat bubble) so the timeline reads more naturally?
- For very large files (>1 MB), should there be a "load anyway" button, or always block?
- Files mode is canvas-only — does it interact with `selectedResult` at all? (Current design: no, files mode is independent of the chat selection.)
- Should the toggle be visible in `single` mode too, or only when there are 2+ results to make `stack` meaningful?
