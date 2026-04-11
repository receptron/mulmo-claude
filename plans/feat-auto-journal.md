# Feature: automatic workspace journal (daily + topic summaries)

## Goal

Automatically distill raw session logs (`workspace/chat/*.jsonl`) into categorised, browseable summaries that the user can skim later — without requiring any manual trigger or "please summarise this" ask.

Two axes of organisation:

- **By day** — `summaries/daily/YYYY/MM/DD.md`: what happened on each day across all sessions
- **By topic** — `summaries/topics/<slug>.md`: long-running topic notes that accrete information as related sessions happen

A top-level `summaries/_index.md` ties both together for quick navigation.

The system is **fully automatic**:

- No user action required to trigger summarisation
- Runs at a configurable interval (default 24h for daily/topic updates, 7d for optimization)
- Remembers what it has already processed and only touches new/changed sessions
- Self-organising: topic taxonomy is discovered by the LLM from session content, not hand-configured
- Self-optimising: a periodic pass merges near-duplicate topics and archives stale ones

## Non-goals

- Not a real-time streaming summariser — batch-only, lag of hours is fine
- Not a search UI — filesystem is the UI; `grep` and the index file are how you navigate
- Not multi-user — assumes a single-user workspace
- Not cross-workspace — summaries stay inside the workspace they describe

## Storage layout

```
workspace/
  chat/                              # EXISTING — raw session logs
    <sessionId>.jsonl                # append-only event log
    <sessionId>.json                 # session metadata
  memory.md                          # EXISTING — distilled facts loaded as context
  summaries/                         # NEW
    _index.md                        # top-level browseable index
    _state.json                      # journal state (see schema below)
    daily/
      2026/
        04/
          11.md                      # summary for 2026-04-11
    topics/
      refactoring.md                 # long-running topic summary
      video-generation.md
      mulmocast.md
    archive/
      topics/
        old-topic-name.md            # topics merged / archived by optimizer
```

### `_state.json` schema

```ts
interface JournalState {
  version: 1;
  // Timestamps of the last successful pass of each kind (ISO 8601).
  lastDailyRunAt: string | null;
  lastOptimizationRunAt: string | null;
  // Intervals between passes. Stored in state so the user can edit
  // them without rebuilding; defaults applied if absent.
  dailyIntervalHours: number;           // default 24
  optimizationIntervalDays: number;     // default 7
  // Sessions whose jsonl has already been ingested, with the last
  // mtime we saw, so we can detect appended events on resumed sessions.
  processedSessions: Record<string, { lastMtimeMs: number }>;
  // Rolling topic slugs known to the journal. The LLM reads these
  // before classifying new sessions so it merges into existing topics
  // rather than inventing near-duplicates.
  knownTopics: string[];
}
```

## Trigger model

**Piggyback on existing session-end events** — the agent loop in `server/routes/agent.ts` already has a `finally { removeSession(); res.end(); }` block. Add a fire-and-forget call to `maybeRunJournal()` there.

`maybeRunJournal()`:
1. Read `_state.json` (create with defaults if absent)
2. If `now - lastDailyRunAt < dailyIntervalHours * 3600e3`, **return** (not due)
3. Otherwise acquire an in-process lock (flag-on-module) so concurrent sessions don't double-run
4. Kick off `runDailyPass()` asynchronously; do not await from the request handler
5. On completion, maybe chain `runOptimizationPass()` if due
6. Release lock, write state

Why not a `setInterval` timer?
- MulmoClaude is idle most of the time; a timer wastes cycles and fires on empty workspaces
- Running at session-end guarantees freshly-written jsonl is available
- Users who don't touch MulmoClaude for a week don't want a 7-day-old summary generated the moment they open it — fine, they'll get it on the next session-end

Why not trigger on startup?
- Nice to have, but redundant with session-end. Possible Phase 1.5 if needed.

## Daily pass — `runDailyPass()`

1. **Discover new/changed sessions**: scan `chat/*.jsonl`, compare mtime against `processedSessions[sessionId].lastMtimeMs`. Collect a list of "dirty" sessions.
2. **Group by day**: for each dirty session, bucket events by their `timestamp` into `YYYY-MM-DD` buckets. A single session resumed across midnight contributes to multiple days.
3. **Read existing state**: for each affected day, read `daily/YYYY/MM/DD.md` if it exists. For topic updates, read `topics/<slug>.md` for any known topics the new content might touch.
4. **Single LLM call per affected day** (keeps token cost predictable):
   - Input: raw session excerpts for that day + existing day summary (if any) + current topic list
   - Output: structured JSON — `{ dailySummaryMarkdown, topicUpdates: [{ slug, action: "create"|"append"|"rewrite", content }] }`
5. **Apply updates**: write `daily/.../DD.md`, create/append/rewrite `topics/<slug>.md` per LLM instructions
6. **Rebuild `_index.md`** from current filesystem state (no LLM needed — pure filesystem walk + sort)
7. **Update `_state.json`**: bump `lastDailyRunAt`, update `processedSessions` mtimes, append any newly-created topic slugs to `knownTopics`

### LLM prompt shape

The archivist is a single `query()` call to the Claude Agent SDK (no MCP plugins, no tools — pure text in, structured text out). System prompt:

> You are the journal archivist for this MulmoClaude workspace. Your job is to distill raw session logs into two artifacts:
> (1) a daily summary capturing what happened on the given date, and
> (2) updates to long-running topic notes.
>
> You receive: a list of session excerpts for a specific day, any existing daily summary for that day, and the current topic list.
>
> You return structured JSON with `dailySummaryMarkdown` and `topicUpdates[]`.
> For each topic update, decide whether to `create`, `append`, or `rewrite`. Prefer `append` for incremental facts; use `rewrite` only if the existing topic has become incoherent.
>
> Match the language of the source session (Japanese stays Japanese, English stays English). Be terse — no filler.

Response is parsed as JSON; on parse failure, skip the day and log the error (don't crash the journal).

## Optimization pass — `runOptimizationPass()`

Triggered when `now - lastOptimizationRunAt >= optimizationIntervalDays * 86400e3`.

1. Read all `topics/*.md`
2. Single LLM call with the full topic list:
   - Input: slug + first ~500 chars of each topic
   - Output: `{ merges: [{ from: [slugs], into: slug, newContent }], archives: [slug] }`
3. Apply merges: write merged content into target, move sources to `archive/topics/`
4. Apply archives: move to `archive/topics/`
5. Rebuild `_index.md`
6. Update `_state.json` (bump `lastOptimizationRunAt`, prune merged slugs from `knownTopics`)

## `_index.md` format

```markdown
# Workspace Journal

*Last updated: 2026-04-11T09:30:00Z*

## Topics

- [Refactoring](topics/refactoring.md) — 12 entries, last updated 2026-04-11
- [Video generation](topics/video-generation.md) — 8 entries, last updated 2026-04-10
- ...

## Recent days

- [2026-04-11](daily/2026/04/11.md)
- [2026-04-10](daily/2026/04/10.md)
- [2026-04-09](daily/2026/04/09.md)
- ...

## Archive

- [Archived topics](archive/topics/) — 3 merged topics
```

Pure filesystem derivation — no LLM. Rebuilt at the end of every journal pass.

## File layout (code)

```
server/
  journal/
    index.ts              # public entry: maybeRunJournal()
    state.ts              # _state.json read/write + schema
    dailyPass.ts          # runDailyPass implementation
    optimizationPass.ts   # runOptimizationPass implementation
    archivist.ts          # LLM call wrapper
    indexFile.ts          # _index.md regeneration
    paths.ts              # pure path helpers (daily path, topic path, slug)
    diff.ts               # pure "what sessions changed since last run" logic
```

Hooked from:
- `server/routes/agent.ts` — `finally` block calls `maybeRunJournal()` (fire-and-forget)

## Testability

All non-LLM logic is extracted into pure functions and lives in files designed to be unit-tested:

- `paths.ts` — `dailyPathFor(date)`, `topicPathFor(slug)`, `slugify(topicName)`
- `diff.ts` — `findDirtySessions(currentMeta, processedState)` takes in-memory data, returns the dirty list
- `state.ts` — `defaultState()`, parse/validate round-trip, `isDailyDue(state, now)`, `isOptimizationDue(state, now)`
- `indexFile.ts` — `buildIndexMarkdown(dirListing, lastUpdatedIso)` pure string builder

The LLM wrapper `archivist.ts` takes an injected `summarize: (prompt) => Promise<string>` so tests can pass a fake. The default exports a real Claude Agent SDK call.

Test files:
```
test/journal/
  test_paths.ts
  test_diff.ts
  test_state.ts
  test_indexFile.ts
```

At minimum each file covers: happy path, empty case, boundary case (interval exactly elapsed), invalid state file (should recover with defaults).

## Risks & mitigations

- **Token cost** — default interval is 24h so worst case is 1 LLM call per day per active workspace. Grouping by day in a single call keeps the ceiling at O(days_touched), not O(sessions). Mitigation: configurable interval in `_state.json`; user can raise it to 72h or lower to 6h.
- **Concurrent runs** — two sessions ending simultaneously could race. Mitigation: in-process module-level lock flag (`running: boolean`). Good enough for single-user single-instance MulmoClaude.
- **Partial writes on crash** — write `_state.json` atomically (write to `_state.json.tmp`, rename). Per-topic/per-day file writes are idempotent because the dirty-session detection re-ingests on next run until `_state.json` is persisted.
- **Runaway topic creation** — LLM invents a new topic for every session. Mitigation: system prompt instructs "prefer existing topics; create new only when no existing topic fits". Optimization pass merges duplicates as a safety net.
- **Clock skew** — `lastDailyRunAt` is local wall-clock. If the user travels timezones, daily buckets could shift. Accept this — it's a personal workspace, not a distributed system.
- **Non-JSON response from LLM** — parse failures are caught per-day; the day is skipped and the next pass retries. Logged to console for debugging.
- **Sessions in progress** — if a session is still active (agent running) when `maybeRunJournal()` fires, its jsonl may be mid-write. Mitigation: skip sessions whose id is in the live registry (`registerSession` in `server/sessions.ts` tracks active ones).

## Implementation order

**Phase 1 — Daily + topic passes + index + hook (this PR):**

1. `server/journal/paths.ts` + tests
2. `server/journal/state.ts` + tests (including atomic write)
3. `server/journal/diff.ts` + tests
4. `server/journal/indexFile.ts` + tests
5. `server/journal/archivist.ts` — LLM wrapper with injectable `summarize`
6. `server/journal/dailyPass.ts` — ties the above together
7. `server/journal/index.ts` — `maybeRunJournal()` entry with lock
8. `server/routes/agent.ts` — call `maybeRunJournal()` in `finally` block (fire-and-forget)
9. Run format / lint / typecheck / build / test
10. Manual smoke: trigger a session, verify `summaries/` gets written on the next session-end after the 24h default (or lower the interval in `_state.json` first for testing)

**Phase 2 — Optimization pass (separate PR):**

11. `server/journal/optimizationPass.ts` + tests for classification logic
12. Chain from `maybeRunJournal` after the daily pass

## Deferred / not in scope

- **Memory.md integration** — `memory.md` is a separate existing concept (distilled facts loaded as context). We leave it alone for now. A future pass could cross-link, e.g. "this topic mentions the fact in memory.md:L23", but it's orthogonal.
- **Retroactive ingest** — on first run, every historical session gets ingested. That's a one-time cost but could be expensive for long-running workspaces. If it becomes a problem, add a `--since` cli flag. Not blocking.
- **Topic pinning / manual tagging** — user might want to mark a topic as "do not archive". Phase 3 idea.
- **UI for browsing summaries** — filesystem is the UI in MulmoClaude's philosophy. Any UI would be Phase 3.

## Test plan

**Unit (automated):**
- `paths.ts` — slugify edge cases (unicode, spaces, punctuation), daily path leap years, month boundary
- `state.ts` — default state creation, corrupted JSON recovery, interval elapsed boundary, atomic write
- `diff.ts` — no processed state (first run), session removed since last run, appended events (mtime bumped)
- `indexFile.ts` — empty journal, 1 topic + 1 day, nested YYYY/MM structure, sort order

**Integration (manual):**
- Lower `dailyIntervalHours` to `0.01` in `_state.json`, trigger a session, verify journal files appear
- Delete `summaries/_state.json`, verify next run recreates it and ingests all sessions
- Corrupt `summaries/_state.json` (invalid JSON), verify the pass falls back to defaults and logs an error
- Two concurrent session-end events: verify only one pass actually runs (lock holds)

**LLM integration (manual, requires API key):**
- Run one real pass, eyeball the resulting `daily/*.md` and `topics/*.md` for quality
- Confirm language preservation (Japanese session → Japanese summary)

No new golden tests — the LLM output is non-deterministic and not golden-testable. Non-LLM logic is covered by unit tests.
