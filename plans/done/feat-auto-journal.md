# Feature: automatic workspace journal (daily + topic summaries)

## Goal

Automatically distill raw session logs (`workspace/chat/*.jsonl`) into categorised, browseable summaries that the user can skim later — without requiring any manual trigger or "please summarise this" ask.

Two axes of organisation:

- **By day** — `summaries/daily/YYYY/MM/DD.md`: what happened on each day across all sessions
- **By topic** — `summaries/topics/<slug>.md`: long-running topic notes that accrete information as related sessions happen

A top-level `summaries/_index.md` ties both together for quick navigation.

The system is **fully automatic**:

- No user action required to trigger summarisation
- Runs at a configurable interval (default 1h for daily/topic updates, 7d for optimization)
- Remembers what it has already processed and only touches new/changed sessions
- Self-organising: topic taxonomy is discovered by the LLM from session content, not hand-configured
- Self-optimising: a periodic pass merges near-duplicate topics and archives stale ones
- Uses the user's `claude` CLI subprocess (not the Claude Agent SDK), so summarisation draws from the user's Claude subscription quota rather than API tokens

## Non-goals

- Not a real-time streaming summariser — batch-only, lag of hours is fine
- Not a search UI — filesystem is the UI; `grep` and the index file are how you navigate
- Not multi-user — assumes a single-user workspace
- Not cross-workspace — summaries stay inside the workspace they describe

## Storage layout

```text
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
  dailyIntervalHours: number;           // default 1
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
- Nice to have, but redundant with session-end for production flows.
- **Debug opt-in added post-initial-design**: set the env var `JOURNAL_FORCE_RUN_ON_STARTUP=1` and `maybeRunJournal({ force: true })` runs immediately after `app.listen`, bypassing the interval gate. The CLI-missing / in-process-lock guards still apply. Used for debugging and for deliberate backfill runs.

## Daily pass — `runDailyPass()`

1. **Discover new/changed sessions**: scan `chat/*.jsonl`, compare mtime against `processedSessions[sessionId].lastMtimeMs`. Collect a list of "dirty" sessions.
2. **Group by day**: for each dirty session, bucket events by their `timestamp` into `YYYY-MM-DD` buckets. A single session resumed across midnight contributes to multiple days.
3. **Pre-compute per-session pending day set**: `sessionToDays: Map<sessionId, Set<date>>` — used to decide when a session is "fully processed" after each day write.
4. **Read existing state**: for each affected day, read `daily/YYYY/MM/DD.md` if it exists. For topic updates, read `topics/<slug>.md` for any known topics the new content might touch.
5. **Single LLM call per affected day** (keeps token cost predictable):
   - Input: raw session excerpts for that day (each with `artifactPaths`) + existing day summary (if any) + current topic list
   - Output: structured JSON — `{ dailySummaryMarkdown, topicUpdates: [{ slug, action: "create"|"append"|"rewrite", content }] }`
6. **Apply updates**: rewrite `/workspace-absolute` links to true-relative, then write `daily/.../DD.md`, create/append/rewrite `topics/<slug>.md` per LLM instructions.
7. **Per-day incremental state checkpoint**: after each day is written successfully, decrement `sessionToDays` for that date; any session whose pending set just became empty is "fully processed" and its record gets added to `processedSessions`. `knownTopics` is also merged in. **`writeState(workspaceRoot, nextState)` is called after every day**, not at the end of the pass, so a mid-run crash only loses work in days still queued — everything up to the last checkpoint survives.
8. **Rebuild `_index.md`** from current filesystem state (no LLM needed — pure filesystem walk + sort).
9. **Final `_state.json` write** in `runJournalPass` bumps `lastDailyRunAt` (only if no days were skipped) and captures optimization-pass output.

### LLM invocation — `claude` CLI subprocess

Rather than calling the Claude Agent SDK (which bills through the API key and burns tokens per-run), the archivist shells out to the user's **`claude` CLI binary**. That routes through the user's Claude subscription quota instead, which is effectively free for this kind of background batch work.

```ts
// Simplified shape. Real code adds timeouts and stderr handling.
import { spawn } from "node:child_process";

async function runClaudeCli(systemPrompt: string, userPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("claude", ["-p", "--output-format", "text"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`claude exited ${code}: ${stderr}`));
    });
    // Send the full archivist prompt via stdin so we don't hit
    // shell argv length limits for large day excerpts.
    child.stdin.write(`${systemPrompt}\n\n---\n\n${userPrompt}`);
    child.stdin.end();
  });
}
```

Constraints and caveats the wrapper must handle:

- **Timeout** — spawn gets a 5-minute wall-clock timeout per invocation. On timeout, kill the child and fail the day (next pass retries).
- **`claude` not on PATH** — on `ENOENT`, log a clear one-liner and disable the journal for the current server lifetime (do not keep retrying on every session-end).
- **Not authenticated / quota exhausted** — surfaces as a non-zero exit with a stderr message; log it and skip the day, retry next pass.
- **stdin piping** — the archivist prompt can include thousands of lines of jsonl excerpts; passing via argv would blow past OS arg limits. Always use stdin.
- **Structured output** — ask the prompt to emit a JSON code fence; parse with a tolerant extractor (`/```json\n([\s\S]*?)\n```/`) and fall back to scanning for the first `{` ... balanced `}` if the fence is missing.

### Prompt shape

The archivist runs with no MCP plugins, no tools — pure text in, structured text out. System prompt:

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

Response is parsed as JSON; on parse failure, skip the day and log the error (don't crash the journal). All subprocess failure modes (ENOENT, timeout, non-zero exit, auth error) are caught inside `archivist.ts` and converted into logged warnings — the journal module never throws into the agent route's `finally` block.

## Cross-linking from summaries

The archivist system prompt has two extra sections that let summaries link back into the workspace rather than being plain-text wall-of-text:

### Artifact links (A)

- The user prompt includes an `ARTIFACTS REFERENCED` section listing workspace-relative file paths produced by the day's sessions. Paths come from `extractArtifactPaths()` in `dailyPass.ts`, which knows:
  - `data.filePath` for plugins that stash one (presentMulmoScript, presentHtml)
  - `wiki/pages/<pageName>.md` synthesised from `manageWiki` results
  - Defensive filters reject absolute, parent-escape, and scheme-like paths
- The archivist is instructed to emit markdown links using **workspace-absolute paths** (`[wiki](/wiki/pages/foo.md)`) so it doesn't have to do relative-path math.
- `linkRewrite.rewriteWorkspaceLinks(currentFileWsPath, content)` post-processes the archivist output before writing the file to disk, converting each `/wiki/foo.md` to the correct `../../wiki/foo.md` for that file's location. No regex — character-level walker to satisfy sonarjs/slow-regex. Preserves `#fragment` suffixes.
- Frontend: `FilesView.vue` intercepts clicks on rendered markdown links via `@click.capture`. Workspace-absolute (`/wiki/foo.md`) and true-relative (`../../wiki/foo.md`) links are resolved against the current file's path with `resolveWorkspaceLink()` and passed to `selectFile()`. External URLs / `#anchor` / `..`-escaping-workspace are passed through or rejected.

### Session links (B)

- The archivist is also told to link sessions it mentions using `/chat/<sessionId>.jsonl`. `linkRewrite` converts these the same way as artifact paths.
- `FilesView` has a specialised branch: after resolving a clicked link, `extractSessionIdFromPath()` checks whether the target is a `chat/<id>.jsonl` and, if so, emits a `loadSession` event instead of opening the raw jsonl as a file.
- `App.vue` binds `@load-session` to a bridge function that calls `loadSession(id)` AND flips `canvasViewMode` out of `files` so the reader actually sees the newly-loaded chat instead of staying on the file tree.
- File-tree clicks on `chat/*.jsonl` are unaffected — they still show the raw jsonl. Only markdown-link clicks take the specialised path.

### Why not vue-router?

This is the narrow case of cross-cutting in-app navigation. Introducing `vue-router` would cover it elegantly along with several other cases (bookmarking, browser back/forward, deep-linking). We deliberately deferred that in favour of the click-handler approach so this PR stays focused. See issue #108 for the comprehensive router-adoption discussion.

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

```text
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

The LLM wrapper `archivist.ts` takes an injected `summarize: (systemPrompt, userPrompt) => Promise<string>` so tests can pass a fake. The default exports `runClaudeCli` which shells out to the `claude` binary. Tests never spawn a subprocess; they supply a deterministic fake that returns canned JSON.

Test files:
```text
test/journal/
  test_paths.ts
  test_diff.ts
  test_state.ts
  test_indexFile.ts
```

At minimum each file covers: happy path, empty case, boundary case (interval exactly elapsed), invalid state file (should recover with defaults).

## Risks & mitigations

- **Token cost** — mitigated by routing through the `claude` CLI (subscription quota) instead of the API SDK. Default interval is 1h so a heavily-used workspace triggers ~24 passes per day worst case, but each pass only invokes the CLI if sessions have actually changed since the last run. Grouping by day keeps the per-pass cost at O(days_touched), not O(sessions). User can raise `dailyIntervalHours` in `_state.json` if they want even less chatter.
- **`claude` CLI dependency** — the feature silently disables itself (with a single warning log) if the `claude` binary isn't installed or authenticated. Existing MulmoClaude functionality is unaffected.
- **Concurrent runs** — two sessions ending simultaneously could race. Mitigation: in-process module-level lock flag (`running: boolean`). Good enough for single-user single-instance MulmoClaude.
- **Partial writes on crash** — write `_state.json` atomically (write to `_state.json.tmp`, rename), AND checkpoint after **every** daily-pass day rather than once at end-of-pass. A mid-pass crash loses only the days still queued; everything up to the last checkpoint is already committed and the next run picks up exactly from the next day. Per-topic/per-day file writes are idempotent because `processedSessions` only advances for sessions whose pending-day set has emptied.
- **Runaway topic creation** — LLM invents a new topic for every session. Mitigation: system prompt instructs "prefer existing topics; create new only when no existing topic fits". Optimization pass merges duplicates as a safety net.
- **Clock skew** — `lastDailyRunAt` is local wall-clock. If the user travels timezones, daily buckets could shift. Accept this — it's a personal workspace, not a distributed system.
- **Non-JSON response from LLM** — parse failures are caught per-day; the day is skipped and the next pass retries. Logged to console for debugging.
- **Sessions in progress** — if a session is still active (agent running) when `maybeRunJournal()` fires, its jsonl may be mid-write. Mitigation: skip sessions whose id is in the live registry (`registerSession` in `server/sessions.ts` tracks active ones).

## Implementation order

**All in this PR** — Phase 1 (daily + topic) and Phase 2 (optimization) ship together:

1. `server/journal/paths.ts` + tests
2. `server/journal/state.ts` + tests (including atomic write)
3. `server/journal/diff.ts` + tests
4. `server/journal/indexFile.ts` + tests
5. `server/journal/archivist.ts` — `claude` CLI subprocess wrapper with injectable `summarize`
6. `server/journal/dailyPass.ts` — ties the above together for daily + topic updates, checkpointing `_state.json` after every day
7. `server/journal/optimizationPass.ts` + tests for classification logic
8. `server/journal/linkRewrite.ts` + tests — `/wiki/foo.md` → `../../wiki/foo.md` post-processor
9. `server/journal/index.ts` — `maybeRunJournal()` entry with lock, chains daily then optimization, supports `{ force: true }` for debug
10. `server/routes/agent.ts` — call `maybeRunJournal()` in `finally` block (fire-and-forget)
11. `server/index.ts` — honour `JOURNAL_FORCE_RUN_ON_STARTUP=1` for debug startup run
12. `src/utils/path/relativeLink.ts` + tests — `isExternalHref`, `resolveWorkspaceLink`, `extractSessionIdFromPath`
13. `src/components/FilesView.vue` — markdown link click handler, emits `loadSession` for chat jsonl targets
14. `src/App.vue` — binds `@load-session` to a bridge that flips `canvasViewMode` out of `files` and calls existing `loadSession(id)`
15. Run format / lint / typecheck / build / test
16. Manual smoke: set `JOURNAL_FORCE_RUN_ON_STARTUP=1`, verify `summaries/` gets written; click a session link inside a summary and verify the sidebar chat switches

## Deferred / not in scope

- **Memory.md integration** — `memory.md` is a separate existing concept (distilled facts loaded as context). We leave it alone for now. A future pass could cross-link, e.g. "this topic mentions the fact in memory.md:L23", but it's orthogonal.
- **Retroactive ingest** — on first run, every historical session gets ingested. That's a one-time cost but could be expensive for long-running workspaces. If it becomes a problem, add a `--since` cli flag. Not blocking.
- **Topic pinning / manual tagging** — user might want to mark a topic as "do not archive". Phase 3 idea.
- **UI for browsing summaries** — filesystem is the UI in MulmoClaude's philosophy. Any UI would be Phase 3.

## Test plan

**Unit (automated):**
- `paths.ts` — slugify edge cases (unicode, spaces, punctuation), daily path leap years, month boundary, dailyPathFor input validation
- `state.ts` — default state creation, corrupted JSON recovery, interval elapsed boundary, atomic write
- `diff.ts` — no processed state (first run), session removed since last run, appended events (mtime bumped)
- `indexFile.ts` — empty journal, 1 topic + 1 day, nested YYYY/MM structure, sort order, slug tie-break on equal timestamps
- `linkRewrite.ts` — `/wiki/foo.md` → `../../wiki/foo.md`, external URL pass-through, `#fragment` preservation, edge cases
- `relativeLink.ts` (frontend) — external href detection, workspace link resolution, session id extraction, `..`-escape rejection
- `archivist.ts` — prompt building (with `ARTIFACTS REFERENCED` block), tolerant JSON extraction, output validation type guards

**Integration (manual):**
- Lower `dailyIntervalHours` to `0.01` in `_state.json`, trigger a session, verify journal files appear
- Delete `summaries/_state.json`, verify next run recreates it and ingests all sessions
- Corrupt `summaries/_state.json` (invalid JSON), verify the pass falls back to defaults and logs an error
- Two concurrent session-end events: verify only one pass actually runs (lock holds)

**LLM integration (manual, requires `claude` CLI installed and authenticated):**
- Run one real pass, eyeball the resulting `daily/*.md` and `topics/*.md` for quality
- Confirm language preservation (Japanese session → Japanese summary)
- Confirm the feature silently no-ops (with one warning log) if `claude` is missing from PATH

No new golden tests — the LLM output is non-deterministic and not golden-testable. Non-LLM logic is covered by unit tests.
