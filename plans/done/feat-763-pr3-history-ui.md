# Wiki edit-history UI (#763 PR 3)

GitHub: https://github.com/receptron/mulmoclaude/issues/944
Builds on:
- #917 — PR 2 (snapshot pipeline + LLM-write hook, merged 2026-04-28)

## Outcome

The per-page wiki view gains a `Content` / `History` tab switcher.
The History tab lists every snapshot for the current slug, lets the
user click into a detail view with a line-level diff, and exposes a
Restore action that round-trips the chosen snapshot through the
existing `POST /api/wiki/pages/:slug/history/:stamp/restore`
endpoint.

The wiki-level tabs (Index / Log / Lint) are untouched; this PR adds
a new tab structure **inside** the page view only.

## UX decisions (chat 2026-04-28)

| # | Topic | Decision |
|---|---|---|
| 1 | Entry point | Tabs inside the per-page view (`Content` / `History`). |
| 2 | List row | Timestamp + editor badge + reason. `bytes` / `sessionId` hidden. |
| 3 | Click on row | Navigate to detail view inside the History tab. |
| 4 | Diff target | Switchable: default "current page vs this snapshot"; toggle to "previous snapshot vs this snapshot". |
| 5 | Frontmatter in diff | Exclude auto-stamped keys (`updated`, `editor`); diff `title` / `created` / `tags` / body. |
| 6 | Restore button | Detail view only, behind a confirm modal. |
| 7 | Restore success | Auto-switch to Content tab + success toast. |
| 8 | Empty state | "No history yet — edit this page and the first version will appear here." |
| 9 | Diff display | ±3 unchanged-context lines + "N lines hidden" expanders. |
| 10 | Restore failure | Inline error banner near the Restore button; stay on detail. |
| 11 | History tab chrome | Page metadata bar visible; per-page chat composer hidden. |
| 12 | List length | Full render + native scroll. |
| 13 | Loading | Spinner. |
| 14 | Page-switch default tab | Always Content. |
| 15 | Within-page tab state | Persist (detail view restored on tab return). |
| 16 | Restore confirm modal | Contextual: timestamp + editor + "Current page will be replaced. Existing history is preserved." |

## Items fixed by recommendation (non-blocking)

- **Diff colours**: red (deletion) / green (addition). Match
  `bg-red-50 text-red-700` and `bg-green-50 text-green-700` patterns
  already used in the app.
- **Detail-view header**: `[← Back]` top-left, `[Restore]` top-right;
  a second row carries saved-by metadata (editor badge + ts +
  reason) and the diff-target toggle.
- **Markdown rendering**: diff is raw text — each `+`/`-` line is
  its own unit, markdown is NOT rendered inside the diff. The
  metadata bar at page level renders the live page normally.
- **"Restored from `<stamp>`" reason string**: stays English. It is
  stored as data on the audit trail and is locale-independent.
- **Keyboard accessibility**: out of scope for v1. Follow-up issue
  if a user requests it later.

## File-level plan

### New files

```
src/plugins/wiki/history/HistoryTab.vue       — list view
src/plugins/wiki/history/HistoryDetail.vue    — detail + diff + restore
src/plugins/wiki/history/RestoreConfirm.vue   — confirm modal
src/plugins/wiki/history/diff.ts              — pure diff helpers (testable)
src/plugins/wiki/history/api.ts               — three API call wrappers
test/plugins/wiki/history/test_diff.ts        — unit tests for diff helpers
e2e/tests/wiki-history-ui.spec.ts             — Playwright happy path
```

### Modified files

```
src/plugins/wiki/View.vue                     — add tab switcher; hide composer on History
src/lang/en.ts                                — pluginWiki.history.* keys (schema source)
src/lang/{ja,zh,ko,es,pt-BR,fr,de}.ts         — same keys, translated
package.json                                  — add `diff` dependency (line-unified diff library)
```

### `View.vue` changes

A `pageTab` ref defaults to `"content"`. Inside the
`action === 'page'` branch:

- Render two tab buttons (`Content` / `History`) styled like the
  existing wiki-level tabs (`bg-blue-50 text-blue-600`).
- Both panels stay mounted (`v-show`) so Q15 state-persistence is
  free — no extra store needed.
- The chat composer (`v-if="action === 'page' && content && isStandaloneWikiRoute"`)
  gains an additional `pageTab === 'content'` clause.
- The metadata bar (`v-if="action === 'page' && hasPageMeta"`) is
  unchanged — it shows on both tabs (Q11=C).
- When the user navigates to a different slug (via the index list
  or the URL hash), reset `pageTab` back to `"content"` (Q14=A).

### `HistoryTab.vue`

- Fetches `GET /api/wiki/pages/:slug/history` on mount.
- States: `loading` → spinner; `loaded` → list (or empty state);
  `selected: stamp | null` → swap to `HistoryDetail`.
- Empty state: i18n string + small explanation (Q8=B).
- Each row is a button with timestamp (relative + absolute on
  hover), editor badge, reason (truncated). data-testid:
  `wiki-history-row-<stamp>`.

### `HistoryDetail.vue`

- Props: `slug`, `stamp`, plus `current: { body, frontmatter }`
  passed from the parent so we don't re-fetch.
- Fetches `GET /api/wiki/pages/:slug/history/:stamp` for the
  selected snapshot.
- Diff toggle (radio / segmented control): "Compare with current"
  / "Compare with previous snapshot". Default = current.
- Renders the diff via `renderUnifiedDiff(left, right)` from
  `diff.ts`.
- Restore button → `RestoreConfirm` modal → on confirm, POST.
- Success path: emit `restored` so the parent View.vue switches
  `pageTab = 'content'` AND the global toast composable shows the
  success message (Q7=B).
- Failure path: inline `<div class="bg-red-50 ...">` above the
  diff with the error message (Q10=B).

### `RestoreConfirm.vue`

- Props: `snapshot` (carries ts + editor + reason).
- Shows the contextual message (Q16=B) with two buttons:
  Cancel / Restore.
- Restore button is disabled (with spinner) while the parent's
  POST is in flight.

### `diff.ts` (pure helpers)

```ts
export interface DiffLine {
  kind: "context" | "add" | "del" | "hunk-header";
  text: string;
}
export interface DiffHunk {
  lines: DiffLine[];
  hiddenBefore?: number;  // collapsed unchanged lines that came before
  hiddenAfter?: number;   // and after
}
export function renderUnifiedDiff(left: string, right: string, contextLines = 3): DiffHunk[];

// Frontmatter handling for Q5=B
export function stripAutoStampKeys(meta: Record<string, unknown>): Record<string, unknown>;
export function joinFrontmatterAndBody(meta: Record<string, unknown>, body: string): string;
```

The `diff` npm package (Apache-2.0, ~10kB) provides the line-level
machinery. We wrap it so the renderer stays decoupled from the
library and tests can assert against a stable shape.

### i18n keys

Under `pluginWiki.history.*` (added to `src/lang/en.ts` first then
mirrored in seven other locales):

```
tabContent              "Content"
tabHistory              "History"
empty                   "No history yet — edit this page and the first version will appear here."
loading                 "Loading history…"
backToList              "Back to history"
restoreButton           "Restore this version"
restoreConfirmTitle     "Restore this version?"
restoreConfirmBody      ({ts, editor}) => "Restore page to the version from {ts} by {editor}? Current page will be replaced. Existing history is preserved."
restoreConfirmAction    "Restore"
restoreConfirmCancel    "Cancel"
restoreSuccessToast     "Page restored."
restoreFailureBanner    ({error}) => "Restore failed: {error}"
compareCurrent          "Compare with current page"
comparePrevious         "Compare with previous version"
diffNoPrevious          "No previous version to compare against."
editorBadgeUser         "User"
editorBadgeLLM          "LLM"
editorBadgeSystem       "System"
hiddenLines             ({count}) => "{count} unchanged lines hidden"
expandHidden            "Show"
```

Function-form values (`({ts, editor}) => ...`) avoid the
vue-i18n XSS warning for keys that interpolate `<>`-flavoured
content. CLAUDE.md i18n rules apply: same keys in same order
across all 8 locales.

## Tests

### Unit (`test/plugins/wiki/history/test_diff.ts`)

- `renderUnifiedDiff` produces the expected hunk shape for
  add/delete/replace/no-change cases.
- ±3 context default; user-set context honoured.
- Long unchanged runs collapse with `hiddenBefore` / `hiddenAfter`
  counts.
- `stripAutoStampKeys` removes only `updated` / `editor`.
- Frontmatter-only diff with auto-stamps stripped → empty diff.

### E2E (`e2e/tests/wiki-history-ui.spec.ts`)

Uses `mockAllApis` to script:
- `GET /history` → 2 snapshots
- `GET /history/<stamp>` → snapshot body
- `POST /restore` → 200

Steps:
1. Navigate to `/wiki/test-page`.
2. Click `History` tab → list shows 2 rows.
3. Click newest row → detail view, diff visible.
4. Click `Restore` → confirm modal → click Restore.
5. Modal closes, tab switches back to Content, success toast shown,
   composer becomes visible again.

Skip the failure-path E2E (covered by an inline unit test on
`HistoryDetail`'s error rendering).

### Manual (covered post-merge during release tests)

- Different editors (`user`, `llm`, `system`) render with the
  correct badge colours.
- Empty-state copy renders for a fresh page.
- Diff with frontmatter-only differences (no body change) is
  empty after auto-stamp strip — no fake hunks.
- Restoring a deleted page works end-to-end (live page recreated).

## Verification before PR

- `yarn typecheck`, `yarn lint`, `yarn format`, `yarn build` clean.
- `yarn test` (the new diff helpers + any unit-level component tests).
- `yarn test:e2e e2e/tests/wiki-history-ui.spec.ts` passes locally.
- All 8 locale files have the same `pluginWiki.history.*` keys.

## Out of scope

- Word-level diff (deferred per #763 plan).
- Page deletion → history cleanup (no DELETE route exists today).
- `manageWiki` MCP `reason` parameter surfacing.
- Keyboard accessibility — separate follow-up if needed.

## References

- #763 (parent), #917 (PR 2 merged), #944 (this PR's tracking issue),
  #940 (directory-level TOCTOU follow-up — not blocking).
