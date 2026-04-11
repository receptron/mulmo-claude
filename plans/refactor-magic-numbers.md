# Refactor: extract magic numbers into config files

## Goal

Move hardcoded numeric literals and magic strings that act as tunable settings out of their use sites and into dedicated config modules, so:

- Tunable values are discoverable in one place per domain
- Duplicated constants (e.g. `slice(0, 3)` in 3 preview components) share a single source of truth
- Algorithmic constants that stay near their use site get named instead of appearing as bare literals

This refactor is **behaviour-preserving**. No values change — only where they are defined.

## Scope

Scanned `src/` and `server/` (excluding tests, `node_modules/`, `dist/`, `plans/`, `.vue` template sections). Classified each numeric/string literal as:

1. **Settings-like** → move to a config file
2. **Algorithm constant** → name in place, keep near use site
3. **Not worth extracting** → leave alone (see "Deferred" section below)
4. **Already well-named** → skip

## Target file layout

```
src/config/ui.ts             # NEW  — client UI knobs
server/config/settings.ts    # NEW  — server knobs
src/utils/tools/pendingCalls.ts   # EXISTING — add PENDING_TICK_INTERVAL_MS next to PENDING_MIN_MS
```

`src/config/` already hosts `roles.ts` and `system-prompt.ts`, so `ui.ts` fits the established convention. `server/config/` is new — the first file under a dedicated server-config directory, intended to grow into the canonical home for server knobs.

## Constants to extract (11 total)

### `src/config/ui.ts` (client)

| Name | Value | Replaces | Rationale |
|---|---|---|---|
| `MAX_VISIBLE_SESSION_TABS` | `6` | `src/App.vue:624` `mergedSessions.value.slice(0, 6)` | How many recent sessions the header tab strip shows |
| `ERROR_BODY_PREVIEW_MAX_CHARS` | `200` | `src/App.vue:925` `errBody.slice(0, 200)` | UI truncation for server error body previews |
| `PREVIEW_ITEM_COUNT` | `3` | `src/plugins/scheduler/Preview.vue:52`, `src/plugins/todo/Preview.vue:30`, `src/plugins/wiki/Preview.vue:37` | Shared preview tile item count (duplicated 3× today) |
| `LS_RIGHT_SIDEBAR_VISIBLE` | `"right_sidebar_visible"` | `src/App.vue:570, 748` | localStorage key |

### `server/config/settings.ts` (server)

| Name | Value | Replaces | Rationale |
|---|---|---|---|
| `DEFAULT_SERVER_PORT` | `3001` | `server/index.ts:37`, `server/routes/agent.ts:11` | Default port fallback when env var is absent (declared twice today) |
| `HTML_TITLE_TRUNCATE_LENGTH` | `50` | `server/routes/html.ts:68, 112` | Title truncation in HTML route responses |
| `X_SEARCH_MIN_RESULTS` | `10` | `server/mcp-tools/x.ts:173` | Lower bound on X search result count |
| `X_SEARCH_MAX_RESULTS` | `100` | `server/mcp-tools/x.ts:171` | Upper bound on X search result count |

### `src/utils/tools/pendingCalls.ts` (in-place, sibling of `PENDING_MIN_MS`)

| Name | Value | Replaces | Rationale |
|---|---|---|---|
| `PENDING_TICK_INTERVAL_MS` | `50` | `src/composables/usePendingCalls.ts:39` `setInterval(..., 50)` | Algorithm parameter tightly coupled with `PENDING_MIN_MS` — belongs next to it, not in a global UI config |

## Deferred (intentionally not extracted)

These were considered and rejected with reason:

- **`setTimeout(..., 0)` at `src/App.vue:981`** — the `0` is a microtask-ish hack to let Vue flush before changing `currentRoleId`. It is not a tunable value; naming it does not help future readers.
- **`slice(2, 7)` in `server/routes/todos.ts:72` and `server/routes/scheduler.ts:81`** — random-ID generation detail. The real fix is replacing `Math.random().toString(36).slice(2, 7)` with `crypto.randomUUID()`, which is a separate concern that should not ride along with a magic-number refactor.
- **`PLUGIN_HEIGHT = "min(60vh, 560px)"` in `src/components/StackView.vue`** — CSS expression string, not a numeric knob. Splitting the `60vh` / `560px` into JS constants would reduce readability and still leave the `min(...)` in template literal form.

## Already well-named (no action)

`PENDING_MIN_MS`, `VIEW_MODE_STORAGE_KEY`, `SCROLL_AMOUNT`, `SCROLL_SPY_SUPPRESS_MS`, `RECENT_THRESHOLD_MS`, `MAX_PREVIEW_BYTES`, `MAX_RAW_BYTES`, `WEEK_COUNT`, `STORAGE_KEY`, `MD_RAW_STORAGE_KEY`.

## Implementation order

1. Create `src/config/ui.ts` with the 4 client constants
2. Update `src/App.vue` to import and use `MAX_VISIBLE_SESSION_TABS`, `ERROR_BODY_PREVIEW_MAX_CHARS`, `LS_RIGHT_SIDEBAR_VISIBLE`
3. Update the three Preview components to import `PREVIEW_ITEM_COUNT`
4. Create `server/config/settings.ts` with the 4 server constants
5. Update `server/index.ts`, `server/routes/agent.ts` to use `DEFAULT_SERVER_PORT`
6. Update `server/routes/html.ts` to use `HTML_TITLE_TRUNCATE_LENGTH`
7. Update `server/mcp-tools/x.ts` to use `X_SEARCH_MIN/MAX_RESULTS`
8. Add `PENDING_TICK_INTERVAL_MS` to `src/utils/tools/pendingCalls.ts`, import in `src/composables/usePendingCalls.ts`
9. Run `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
10. Commit as one change, push, open PR stacked on `refactor/app-vue`

## Risks & mitigation

- **PR #100 stacking** — this branch is cut from `refactor/app-vue` (not `main`), so imports and directory paths match the latest utils reorg. When PR #100 merges first, this branch will fast-forward cleanly against main.
- **Behaviour drift** — no numeric value changes, only relocation. Existing tests (122) must remain green.
- **Template bindings** — any template using the raw literal (e.g. `v-if="..."` not found, but worth double-checking) would not be covered by a script import. Only `.vue` `<script setup>` and `.ts` files are in scope; templates were audited and contain no magic numbers worth extracting (Tailwind tokens excluded per criteria).

## Test plan

- `yarn test` — all 122 existing tests must remain green
- Manual smoke:
  - Open the app; tab strip still shows at most 6 sessions
  - Trigger a server error (e.g. kill server mid-request); error card body ≤ 200 chars
  - Toggle right sidebar; state persists across reload (localStorage key unchanged)
  - Open scheduler/todo/wiki previews in the sidebar; each shows up to 3 items with an "+N more" indicator
  - Start the server on default port `3001`; agent endpoint still reachable
  - Run a tool call; spinner stays visible ≥500ms (unchanged)

No new unit tests are planned — each extracted constant is trivially correct and would only exercise `assert.equal(SOME_CONSTANT, literal)`, which has no signal.
