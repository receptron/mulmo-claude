# Plan: Accounting plugin — follow-ups before GA

The original plan (`plans/done/feat-accounting.md`) shipped server, REST, pub/sub, frontend plugin, i18n in all 8 locales, hard-constraint isolation, and unit tests. This plan covers the remaining rollout-checklist items so the test-rollout phase can actually begin.

GA itself (route registration, launcher button, role inclusion) is still out of scope — that comes after a soak window.

## Scope

Eight items, all landing in one PR:

1. **Drop the magic `"default"` bookId** — generate ids for every book including the first.
2. **Allow deleting the last book** — empty workspace becomes a legitimate state.
3. **Async snapshot rebuild + test mechanism (priority 1)** — replace today's lazy rebuild with the queued background rebuilder the original plan described, and add a deterministic test-only API so unit and E2E tests can wait for rebuilds without flake.
4. **Single confirmation when voiding a journal entry** — currently two dialogs fire back-to-back; collapse to one.
5. **Void rendering and memo** — strikeout the original entry (not the voiding entry), and write a human-readable memo on the voiding entry.
6. **E2E Playwright coverage** — both isolation regression and functional flow.
7. **`docs/manual-testing.md`** — accounting trial-operation section.
8. **`docs/ui-cheatsheet.md`** — accounting `<View>` block, `data-testid` map, and "tool-result mount, no route" callout.

## 1. Drop the magic `"default"` bookId

The original plan put the first book at `books/default/` and treated `"default"` as a bootstrap id. That string carries no information — it's just "the book that happened to be created first." Better: every book, including the very first one, gets a generated id, and `config.json.activeBookId` is the only "which book am I looking at" pointer.

No migration is needed — the test rollout has no users yet whose data we have to preserve.

Changes:

- **`server/accounting/service.ts`** — `createBook` always assigns a fresh id. The bootstrap path that creates the first book on a fresh workspace runs through the same code path; nothing passes the literal `"default"` anywhere.
- **`server/utils/files/accounting-io.ts`** / **`server/workspace/paths.ts`** — confirm no path constant or helper bakes in `default` as a substring. Book directory names come entirely from the runtime id.
- **Empty workspace state** — when no book exists yet, `config.json.activeBookId` is `null`. APIs that take `bookId?` and find `activeBookId === null` return a clear "no active book" error rather than auto-creating or falling back to a magic id. `View.vue` already has the `accounting-no-book` branch for this state.
- **Id format** — short uuid (e.g. first 8 chars of `crypto.randomUUID()`, with a collision retry) is the simplest. Slug-from-name is tempting but invites collision handling and rename complexity; defer unless a UX need surfaces.
- **Tests** — any fixture under `test/accounting/` or `test/fixtures/accounting/` that hard-codes `"default"` updates to use the value returned from `createBook` (or a deterministic test seed). Prefer reading the id from the API over hard-coding.

This is a behavior delta from `plans/done/feat-accounting.md` — note it in the PR description so reviewers don't double-check the old plan.

## 2. Allow deleting the last book

The original plan's `deleteBook` action refused when only one book remained. With Section 1 making "no active book" a first-class empty state, that guard is no longer protective — it just creates a one-way trap (a user who wants a fresh start has to hand-edit the workspace).

Lift the guard. After deleting the last book, `config.json.activeBookId` becomes `null` and `View.vue` renders its existing `accounting-no-book` branch with the "create a book" affordance.

Changes:

- **`server/accounting/service.ts`** — drop the "last book" check in `deleteBook`. The remaining safety is still the `confirm: true` flag.
- **`activeBookId` after delete**:
  - If the deleted book was active and other books remain: pick one (most-recently-created is the most user-meaningful default) and set it active. Publish on `PUBSUB_CHANNELS.accountingBooks` so `BookSwitcher.vue` re-renders.
  - If the deleted book was the last one: `activeBookId = null`. Publish on `PUBSUB_CHANNELS.accountingBooks`.
- **Server unit test** — `test/accounting/test_service.ts`: deleting the last book leaves the workspace with zero books and `activeBookId === null`; subsequent `listBooks` returns `[]`; subsequent `addEntry` without explicit `bookId` returns the "no active book" error from Section 1.
- **E2E** — extend `flow.spec.ts`: with one book present, delete it; confirm the empty state renders and `BookSwitcher` shows no options.
- **Manual testing checklist** (Section 7) — replace "confirm last-book deletion is blocked" with "delete the last book → empty state appears → re-create a book → BookSwitcher shows just the new id."

Depends on Section 1 — land them together.

## 3. Async snapshot rebuild + test mechanism (priority 1)

`server/accounting/snapshotCache.ts` today invalidates synchronously on writes and rebuilds lazily on the next `getOrBuildSnapshot`. The original plan called for a background queue that fires off after every write so the cache is warm when the user looks. The file's own header comment (lines 16–22 of `snapshotCache.ts`) acknowledges the gap.

This PR turns the design on:

- **`scheduleRebuild(bookId, fromPeriod)`** added to `snapshotCache.ts`. Every write path calls it after `invalidateSnapshotsFrom` returns: `addEntry` / `voidEntry` / `setOpeningBalances` / `upsertAccount` (when account type changes) / the `rebuildSnapshots` admin action.
- **In-process serialization**: a `Map<bookId, { running: Promise<void>; pendingFromPeriod: string | null; coalescedWriteCount: number }>`. While a rebuild is in flight, additional writes for the same book do **not** start a parallel rebuild — they merge into a single queued follow-up (`pendingFromPeriod = min(existing, new)`). Net behavior: at most two rebuilds for any burst of writes on the same book.
- **Pub/sub events**, published via `server/accounting/eventPublisher.ts`:
  - On invalidate: `{kind: "snapshots-rebuilding", period: fromPeriod}` — once per scheduled rebuild.
  - On each successfully rewritten month during the walk: `{kind: "snapshots-ready", period}`. Tests and the View can correlate a `snapshots-ready` whose `period` matches the most recent `snapshots-rebuilding` to know "the queue has caught up to here."
- **Lazy fallback stays**: `getOrBuildSnapshot` keeps its current behavior. If a report is requested before the rebuild reaches that month, it builds inline. The two paths must produce byte-identical results — the existing invariant test (`test/accounting/test_snapshotCache.ts`) enforces this.
- **No View-side changes for correctness**. `useAccountingChannel` already routes `snapshotsReady`. Optional later polish: a "recomputing…" hint in report tabs while `snapshots-rebuilding` is the most recent event for the active period — out of scope here.

### Test mechanism

Async rebuild is unobservable without a primitive — sleep-and-poll is flaky and slow. Add a small **test/diagnostic surface** on `snapshotCache.ts`. It is exported because tests need it; production code paths never call it (documented at the export site).

```ts
/** Test/diagnostic: resolves when no rebuild is running or queued for
 *  `bookId`. Production code never needs this — the lazy fallback in
 *  getOrBuildSnapshot makes blocking on the rebuild unnecessary. */
export function awaitRebuildIdle(bookId: string): Promise<void>;

/** Test/diagnostic: snapshot of the per-book queue state. Stable
 *  enough to assert against; fields may grow over time. */
export function inspectRebuildQueue(bookId: string): {
  running: boolean;
  runningFromPeriod: string | null;   // fromPeriod of the in-flight rebuild
  pendingFromPeriod: string | null;   // earliest queued fromPeriod, or null
  coalescedWriteCount: number;        // writes folded into running + pending
};
```

Unit tests in `test/accounting/test_snapshotCache.ts` use these to assert:

- After `addEntry`, `awaitRebuildIdle` resolves and the matching snapshot file is on disk before the next assertion. No `setTimeout`/polling.
- Five rapid `addEntry` calls on the same book produce **at most two rebuilds** — verified by counting `snapshots-rebuilding` events and by `coalescedWriteCount ≥ 5`.
- Pub/sub event order: every `snapshots-rebuilding` is followed by ≥ 1 `snapshots-ready` for the same or a later period before the next `snapshots-rebuilding` for that book.
- `getReport` called *during* a rebuild returns correct numbers via the lazy path (snapshot-equality invariant still holds with the new code path).
- `awaitRebuildIdle` on an already-idle book resolves on the next microtask (does not hang).
- A rejection inside one rebuild does not poison the queue for the next write — the next `scheduleRebuild` starts a fresh promise.

E2E (Playwright) does **not** call the test API. It asserts user-visible behavior:

- After a write through the mounted app (or simulated via direct `/api/accounting` POST from the test harness), the View receives `snapshots-ready` over its pub/sub subscription within a 2 s timeout, and the displayed B/S updates without manual reload.
- Two writes in quick succession produce ≥ 1 `snapshots-rebuilding` and ≥ 1 `snapshots-ready` (asserts the pipe, not the queue internals).

For manual verification (Section 7 will reference this): emit INFO-level log lines `snapshot rebuild started bookId=… fromPeriod=…` and `snapshot rebuild done bookId=… periods=N` at the start and end of each rebuild, using the `server/utils/log.ts` helpers. A human watching the server log during an `addEntry` should see exactly one start/done pair per write burst.

## 4. Single confirmation when voiding a journal entry

Today, voiding a journal entry from the UI fires two confirmation dialogs in a row. The user should see exactly one.

Investigation step (do this before writing the fix): find the two sources. Likely candidates:

- A native `window.confirm()` in the void click handler stacked on top of a custom modal — or vice versa, native at one layer and custom at another.
- A wrapper component (e.g. row-level vs list-level) that also confirms.
- The void path passing through a generic confirm helper that the caller already used.

Fix rule: keep the custom modal (matches the rest of the app's dialog style and is what `e2e/` can reliably target by `data-testid`), remove the native `confirm()`. Verify there's exactly one path: click → modal → confirm → REST call → list refetch via pub/sub.

E2E assertion lives in `flow.spec.ts` (Section 6): clicking void shows exactly one dialog (assert by counting dialog/modal nodes); confirming it removes the entry from the visible list.

## 5. Void rendering and memo

Two small fixes to the void flow, both visible to the user.

### Strikeout is on the wrong row

When entry A is voided, the system appends a voiding entry B that reverses A's amounts. Today `src/plugins/accounting/components/JournalList.vue` applies the strikeout to B (the voiding entry) instead of A (the entry that was actually cancelled).

Fix: bind the strikeout to "this row's id is in `voidedEntryIds`" rather than "this row's `kind === "void"`". Original A gets the strikeout; B renders as a normal correction record.

`server/accounting/journal.ts` already has `voidedIdSet`. Either include the set in the `listEntries` response (preferred — server is the single source of truth) or compute it client-side from the same payload. Either path, the View consults the set and applies the strikeout class to matching rows.

### Voiding-entry memo should be human-readable

`makeVoidEntries` in `server/accounting/journal.ts` currently produces `"void of {entryId}"` — entry ids are opaque. Replace with `"void of '{original memo}' on {original date}"`.

"Original memo" precedence:
- Use the original entry's top-level memo if present.
- Else use the first line's memo.
- Else fall back to `"void of entry on {original date}"` (no quoted memo).

i18n: add `accounting.voidMemoTemplate` and `accounting.voidMemoTemplateNoMemo` to all 8 locales (`{memo}` / `{date}` placeholders). Resolve at memo-creation time using the active UI locale — memos are frozen text once written, so voiding from a different locale later won't retranslate. That's accepted.

No backfill — existing void entries (if any) keep their old memos. Per the test-rollout posture, no real users to migrate.

### Tests

- Unit (`test/accounting/test_journal.ts`): `makeVoidEntries` produces the new memo format in both the with-memo and no-memo cases; existing assertions on `"void of {id}"` updated.
- E2E (`flow.spec.ts`, Section 6): after voiding an entry, the *original* row carries the strikeout class (assert via class or `data-testid`); the voiding row's memo contains the original memo string and the original date.

## 6. E2E tests

File layout under `e2e/tests/accounting/`:

- `isolation.spec.ts` — runs in the **default Role environment** (no fixture injection):
  - PluginLauncher renders without an `accounting` button — assert by `data-testid` absence.
  - Direct navigation to `/accounting` does not match any route — assert the canvas falls back to whatever `/` shows (NotFound or default surface, whichever the router yields).
  - The default-Role MCP tool list does not include `manageAccounting`. Drive this by inspecting the rendered tool picker / role config UI rather than by mocking an LLM round-trip.
- `flow.spec.ts` — runs with a **custom Role injected via `e2e/fixtures/`** that has `availablePlugins: ["manageAccounting"]`:
  - Mock `manageAccounting({action:"openApp"})` to return the `accounting-app` envelope and assert `<View>` mounts on canvas.
  - Inside the mounted app, drive UI clicks for: create book → enter opening balances (assert save button stays disabled until Σ debit = Σ credit) → add a journal entry → see it in the journal list → switch to B/S tab and see the entry reflected.
  - Use Playwright's network observer to assert that every in-app click hits `/api/accounting` directly (no SSE / `/api/agent` round-trip).
  - **Pub/sub reflection**: with the app mounted, write a journal entry by hitting `/api/accounting` directly from the test (simulating a second writer), and assert the journal list and B/S refetch within a short timeout *without* a manual reload.
  - **Opening edit**: set opening balances, navigate away, return — assert the form shows the new values, not the original ones.
  - **BookSwitcher**: with two books present, switch and assert the journal list contents change.

E2E fixtures:
- Add `e2e/fixtures/roles/accounting.json` (custom Role with `manageAccounting`) and a helper in `e2e/fixtures/accounting.ts` for the mock `manageAccounting` tool response and a small known-good chart of accounts seed.
- Use `mockAllApis(page)` per existing pattern; extend it (or add a sibling) to handle `/api/accounting` POST routes against an in-memory fake when a test needs deterministic state.

Out of scope for E2E: ledger drilldown, void flows, multi-currency. Those can be added once the basics are green and we know what's stable.

## 7. `docs/manual-testing.md`

Add a section titled **"Accounting plugin (test rollout)"** with:

- Setup steps: create a custom Role with `manageAccounting` in `availablePlugins` (file-edit path *and* GUI plugin-picker path — show both, since the original plan made supporting both a hard constraint).
- Smoke checklist for a fresh book: create book → set opening → add an income entry → add an expense entry → check B/S and P/L → switch books → delete a non-active book → delete the last book → confirm the empty state appears → create a new book and confirm `BookSwitcher` shows just the new id.
- Recovery drills: delete a snapshot file by hand and call `getReport` (lazy fallback path) → run `rebuildSnapshots` from the settings tab and confirm cache files reappear → corrupt a single line in a journal JSONL and confirm the loader skips it with a warning rather than failing the whole month.
- Soak instructions: developers running personal books for 1–2 months before GA flip is considered. Note where to file issues.

## 8. `docs/ui-cheatsheet.md`

Add an `<AccountingApp>` block matching the existing format:

- ASCII layout of `View.vue`: header with `<BookSwitcher>` + tab strip (journal / newEntry / opening / ledger / balanceSheet / profitLoss / settings), body region per tab.
- `data-testid` table: at minimum `accounting-no-book`, `accounting-book-select`, `accounting-tab-{key}`, `accounting-journal-row`, `accounting-opening-save`, `accounting-balance-row` — confirm or extend by grepping `src/plugins/accounting/` and listing what's actually emitted.
- A short callout: "Mounted via tool-result envelope `kind: "accounting-app"`. **No `/accounting` route.** Default Role cannot reach this surface; only custom Roles whose `availablePlugins` include `manageAccounting`."

When updating, match the discipline the cheatsheet asks for: if a `data-testid` is renamed during this PR, fix the block in the same diff.

## Out of scope (still)

- Multi-currency, tax rules, external imports, PDF/Excel export, signed audit log, bank statement ingestion — same as the original plan.
- GA flip itself: route registration, launcher button, role inclusion, CHANGELOG. That waits until the soak window completes.

## Rollout checklist

Single PR (closes the test-rollout phase):

- [ ] First-book bootstrap uses a generated id; no `"default"` literal remains in `server/accounting/` or `server/utils/files/accounting-io.ts`
- [ ] `deleteBook` allows removing the last book; empty state renders; auto-promote when deleting an active-but-not-last book
- [ ] Voiding a journal entry shows exactly one confirmation dialog; covered by E2E assertion
- [ ] Strikeout class applies to the voided (original) row, not the voiding row
- [ ] Voiding-entry memo follows `void of '{memo}' on {date}` template; i18n keys added in all 8 locales
- [ ] `scheduleRebuild` + per-book queue in `server/accounting/snapshotCache.ts`; every write path fires it after invalidation
- [ ] `snapshots-rebuilding` and `snapshots-ready` published via `server/accounting/eventPublisher.ts`
- [ ] `awaitRebuildIdle` + `inspectRebuildQueue` test/diagnostic surface exported and documented as test-only
- [ ] INFO log lines on rebuild start/done for manual verification
- [ ] `test/accounting/test_snapshotCache.ts` covers: coalescing (≤2 rebuilds for 5 rapid writes), event ordering, lazy-path correctness during rebuild, queue recovery after a failed rebuild
- [ ] `e2e/tests/accounting/isolation.spec.ts`
- [ ] `e2e/tests/accounting/flow.spec.ts` (includes `snapshots-rebuilding` → `snapshots-ready` arrival assertion and B/S auto-update without manual reload)
- [ ] `e2e/fixtures/roles/accounting.json` + `e2e/fixtures/accounting.ts`
- [ ] `docs/manual-testing.md` — accounting section (includes the "watch the log" rebuild-verification drill)
- [ ] `docs/ui-cheatsheet.md` — `<AccountingApp>` block
- [ ] Verified hard constraints still hold: `git diff src/config/roles.ts`, `git diff src/components/PluginLauncher.vue`, `git diff src/App.vue` all empty after this PR
