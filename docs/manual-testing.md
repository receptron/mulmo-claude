# Manual Testing Guide

Things that E2E (`yarn test:e2e`) **cannot** cover reliably, and must be
checked by hand before a release or after a change that touches the
relevant area.

The goal of this doc is to keep the list of "manual-only" responsibilities
*finite and maintained* — if something moves into E2E coverage, strike it
out; if a new thing proves untestable, add it here with a reason.

> **Contributor note**: any PR that deliberately leaves a scenario uncovered
> by E2E (because the testing framework can't reach it) **must add an entry
> here** with the scenario, the reason it's untestable, and how to smoke-check
> it. See [CLAUDE.md → Manual Testing](../CLAUDE.md#manual-testing) for the
> workflow contract.

---

## 1. Drag-and-drop interactions

**Why manual**: `vuedraggable` wraps `Sortable.js`, which relies on native
HTML5 drag events. Playwright's synthetic mouse events (`page.mouse.down/move/up`,
`page.dragTo()`) don't trigger `dragstart` reliably on Sortable's listeners,
and the library's internal clone-swap isn't visible through standard DOM
assertions even when the drag does fire. Attempts consistently flake.

### What to check

| Surface | Flow |
|---|---|
| **Todo Kanban — card between columns** | Open `todos/todos.json`, drag a card from one column to another, verify it lands in the drop target + refreshes with the new status |
| **Todo Kanban — card reorder within column** | Drag a card up/down inside the same column, verify the new order persists after refresh |
| **Todo Kanban — column reorder** | Drag a column header sideways, verify `order` persists |

**Server contract is already covered**: `POST /api/todos/items/:id/move` is
exercised by the list-view checkbox toggle test in
`e2e/tests/todo-items-crud.spec.ts`, so the API wiring is not in question —
only the UI wiring of the drag itself.

## 2. Canvas-based UI

**Why manual**: HTML `<canvas>` pixel state isn't accessible to Playwright's
assertion APIs in a deterministic way (`getImageData` needs the test to
understand the exact pixel layout, which is brittle to rendering differences
across OS/GPU).

### What to check

- **Image plugin — draw to canvas**: enter a canvas view, draw with the
  brush, verify strokes appear visibly
- **Image plugin — save after drawing**: click Save, verify the image
  persists (reopen the session → image reloads with strokes intact)
- **Style application**: apply a style preset, save, reopen → style stays

## 3. Iframe-sandboxed content rendering

**Why manual**: `presentHtml` (and any future HTML rendering plugin) uses a
CSP-sandboxed iframe. Playwright can see the iframe element exists but
can't introspect content behind the sandbox boundary, and auto-height
sizing relies on the iframe's own `load` event firing against its rendered
document.

### What to check

- **Stack view — presentHtml natural height**: a multi-screen HTML result
  should expand to its full content height, no inner scrollbar. Same for
  `presentDocument` / `presentSpreadsheet` / `manageWiki`.
- **Single view — iframe scroll**: long HTML scrolls internally without
  breaking the host page layout.

## 4. LLM + agent driven flows (require real backend)

**Why manual**: E2E mocks `/api/agent` entirely. Anything that exercises
the Claude CLI + MCP + real file system side effects needs an actual
`yarn dev` run.

### What to check after changes to agent / MCP / plugins

- **Session jsonl contents**: inspect `~/mulmoclaude/chat/<id>.jsonl`
  after a turn, verify:
  - User + assistant text appended
  - `tool_call` and `tool_call_result` records present (tool-trace #195)
  - WebSearch results stored as `contentRef` to `workspace/searches/*.md`,
    not inline base64
- **Wiki backlinks**: after a turn that creates/edits a wiki page, the
  page ends with `<!-- journal-session-backlinks -->` + a `## History`
  section linking to the originating `chat/<id>.jsonl` (#193)
- **Workspace artifact pointers**: image plugin saves to
  `workspace/images/<hash>.png` and the tool result carries the path, not
  base64; wiki pages reference images via path, not base64
- **Role switching**: switch role mid-session → context resets, correct
  MCP tool palette loads (check `claude mcp list` output)
- **Journal daily pass**: run with `JOURNAL_FORCE_RUN_ON_STARTUP=1` and
  verify `workspace/summaries/daily/YYYY/MM/DD.md` gets written
- **Stale `claude --resume` fail-over (#211)**: open an existing session,
  edit `~/mulmoclaude/chat/<id>.json` to set `claudeSessionId` to a
  random UUID the CLI has never seen. Send a message and verify:
  (a) a status event "Previous session unavailable — continuing with
  local transcript." surfaces in the UI, (b) the assistant reply
  arrives and makes sense given the transcript, (c) after the turn
  `chat/<id>.json` carries a fresh `claudeSessionId` (the new one
  issued by the retried run), and (d) a follow-up turn resumes
  cleanly on the new id. E2E is skipped here because faking the
  Claude CLI's stderr across a real subprocess is brittle; the stale
  detection + preamble construction are unit-tested in
  `test/agent/test_resumeFailover.ts`.

## 5. Log output (not asserted by E2E)

**Why manual**: the file-sink log goes to `server/system/logs/` and is not
wired into the test assertions. Spot-checking is usually enough.

### What to check after logger changes

- **Startup**: `yarn dev` → console shows `[workspace] / [sandbox] /
  [mcp] / [server] / [task-manager]` info lines at normal ISO timestamps
- **Agent path**: `server/system/logs/server-YYYY-MM-DD.log` contains `[agent]`
  request received / completed / CLI stderr line-by-line entries
- **Tool-trace**: `[tool-trace] web_search starting` + `web_search saved`
  pair for a WebSearch turn; debug-level entries visible only under
  `LOG_CONSOLE_LEVEL=debug`
- **CSRF reject**: hit the server from a non-localhost Origin →
  `[csrf] rejected cross-origin request` warn entry

See [`docs/logging.md`](logging.md) for the full logger reference.

## 6. Editor save-failure UX (markdown + presentMulmoScript)

**Why manual**: an E2E that mocks `PUT /api/markdowns/:file` or
`POST /api/mulmo-script/update-beat` with a 500 proved flaky when run
alongside the rest of the presentMulmoScript suite — the mocked
request was occasionally unobserved even though the test passed in
isolation. The fix is exercised by the same flow in production; the
manual smoke below is enough to catch a regression.

### What to check

| Surface | Flow |
|---|---|
| **markdown plugin edit** | Open a markdown tool result → "Edit Markdown Source" → change text → disconnect network (devtools) → click "Apply Changes". Editor stays open, a red "Save failed: …" box appears, editor content unchanged. Reconnect + retry succeeds. |
| **presentMulmoScript beat edit** | Open a MulmoScript tool result → "Show source" on a beat → change JSON → disconnect network → click "Update". Editor stays open, red "Save failed: …" inline message near Update, JSON unchanged. Reconnect + retry succeeds. |

**Server contract is already covered**: the render-beat 500-path E2E
exercises the same `{ error }` response shape — only the *editor UI
wiring* on save failure needs manual verification.

## 7. Cross-browser / responsive (beyond Chromium)

**Why manual**: E2E runs only Chromium (see `e2e/playwright.config.ts`).

### What to check before a release

- Safari / Firefox smoke: app loads, sessions list, sending a message, file
  explorer expands, no console errors
- Window resize: sidebar collapses / re-expands, canvas view scales

---

## Updating this document

When you land a PR:

1. If the change adds E2E coverage for a scenario previously listed here →
   **remove** the entry (or strike it through with a link to the covering
   test).
2. If the change introduces a new UI surface or backend behaviour that
   E2E can't reach → **add** an entry with the flow + the reason it's
   untestable.
3. Keep this doc focused on *persistent* manual-test obligations, not
   per-PR smoke-test notes (those belong in the PR description).

The enforcement is on the honour system — no automation ensures this doc
stays current. But it's the only place that keeps the out-of-E2E surface
from silently growing, so treat entries here as first-class test
artifacts.
