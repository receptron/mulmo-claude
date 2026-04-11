# Plan: AI-generated titles in the history sidebar

Tracked in: #123
Supersedes: [#94 (closed)](https://github.com/receptron/mulmoclaude/pull/94) — *feat: chat history index + search*

## Problem

The sidebar history pane (`src/App.vue` line 184) currently falls back to the **first user message** as the one-line preview for every past session. That's often cryptic and makes it hard to tell sessions apart at a glance:

```
You: 2週間分の予定を作って
You: 次のステップを教えて
You: さっきの話の続きだけど
```

The workspace journal (`server/journal/`) produces topic / daily summaries, but it does **not** look at the sidebar session list — sessions are still keyed by raw first message.

## Solution

Summarize each session jsonl once via `claude --model haiku` and cache the result under `chat/index/`. The `/api/sessions` endpoint joins the cached entries by id and returns `title` as the preview plus `summary` as a second line. The sidebar renders a two-line row instead of one.

The pattern, the summarizer, and the cache layout are cherry-picked from the closed PR #94. Everything downstream of "sidebar shows a better title" is dropped.

## Relationship to PR #94

PR #94 shipped three phases:

| Phase | What it did | Status in this plan |
|---|---|---|
| **1** | Background indexer + summarizer + `setInterval` scheduler, writing `chat/index/<id>.json` + `manifest.json` | **Reused** — keep summarizer + per-session file + manifest. **Drop** the 6-hour `setInterval` scheduler; fire from the agent `finally` hook instead. |
| **2** | `/api/sessions` reads the manifest and `src/App.vue` renders `session.summary` as a second line | **Reused** verbatim (both files need small changes relative to the current main) |
| **3** | `searchChatHistory` MCP tool with scoring (keyword +5 / title +3 / summary +1), `src/plugins/searchChatHistory/`, `server/routes/chat-history.ts`, `server/chat-index/search.ts`, `agent/prompt.ts` hint, every role opted-in | **Dropped entirely** — the journal's `summaries/_index.md` + topic files already cover past-conversation lookup, and #117 wires a journal pointer into the agent's first-turn context. |

**Why drop Phase 3:** Topic summaries are already distilled knowledge; session summaries are noisier and lower information-density. Giving Claude a scoring-based full-text search across session summaries duplicates what the topic files do better. Claude can still read individual session jsonls via `read` if it genuinely needs transcript detail — that's rare enough not to warrant a dedicated tool.

## Trigger: fire from agent finally, not setInterval

PR #94's `server/chat-index/scheduler.ts` set up a `setInterval` in `server/index.ts` that refreshed stale sessions every 6 hours. That works but duplicates the "am I due to run?" machinery the journal already has.

The new design mirrors `maybeRunJournal`:

```ts
// server/routes/agent.ts (finally block)
removeSession(sessionId);
res.end();
maybeRunJournal({ activeSessionIds: getActiveSessionIds() }).catch(...);
maybeIndexSession({ sessionId, activeSessionIds: getActiveSessionIds() }).catch(...);
```

`maybeIndexSession` is fire-and-forget, self-locking, and self-gated:

- **Session-scoped**: only indexes the one session that just ended, not a batch scan
- **Freshness throttle**: if `chat/index/<id>.json` already exists and its `indexedAt` is within `MIN_INDEX_INTERVAL_MS` (default 15 min), return early. This keeps claude spawn cost bounded on long conversations — a 20-turn chat over 30 min produces ~2 summarization calls instead of 20
- **Claude CLI sentinel**: same `ClaudeCliNotFoundError` disable-for-lifetime pattern the journal uses, so missing `claude` doesn't spam warnings

No `setInterval`. No `server/index.ts` registration. No `CHAT_INDEX_REFRESH_HOURS` / `CHAT_INDEX_BATCH_SIZE` env vars.

## Backfill

Legacy sessions (created before this feature lands) are indexed lazily as the user revisits and continues them. The sidebar gracefully falls back to the first-user-message preview for any session without an index entry.

For an immediate one-shot backfill over every existing session — useful the first time the feature is rolled out, or for debugging the indexer itself — there are two manual triggers:

**Startup switch** (mirrors the journal's `JOURNAL_FORCE_RUN_ON_STARTUP=1`):

```bash
CHAT_INDEX_FORCE_RUN_ON_STARTUP=1 yarn dev
```

The server boots, walks every `chat/*.jsonl`, spawns claude for each, and logs each indexed session. The `force: true` flag propagated through the indexer bypasses both the freshness throttle and the `activeSessionIds` guard.

**Runtime endpoint** (no restart required):

```bash
curl -X POST http://localhost:3000/api/chat-index/rebuild
```

`POST /api/chat-index/rebuild` calls `backfillAllSessions()` and returns `{ total, indexed, skipped }`. Server logs each indexed session as it goes so progress is visible in the terminal.

## File layout (proposed)

```
server/chat-index/
  types.ts        ChatIndexEntry, ChatIndexManifest, SummaryResult
  summarizer.ts   extractText, truncate, summarizeJsonl, parseClaudeJsonResult, validateSummaryResult
  indexer.ts      readManifest, writeManifest, indexSession, isFresh
  index.ts        maybeIndexSession (public entry, fire-and-forget, lock + sentinel)

test/server/chat-index/
  test_summarizer.ts   extractText / truncate / parseClaudeJsonResult / validateSummaryResult — no claude CLI
  test_indexer.ts      indexSession with summarize stub: happy path, freshness skip, manifest upsert + sort, write failure tolerance
  test_index.ts        maybeIndexSession with lock + activeSessionIds guard
```

Existing files to edit:

- `server/routes/agent.ts` — add the `maybeIndexSession(...)` call in `finally`
- `server/routes/sessions.ts` — load manifest once per `/api/sessions` request, join by id, prefer `indexEntry.title` for `preview`, spread `summary` / `keywords` when defined
- `src/App.vue` — render `session.summary` as a second line in the history popup
- `src/types/session.ts` — already has optional `summary` / `keywords` fields marked "populated by the chat indexer (PR #94) when present" (see `src/types/session.ts:22-23`). Update the comment to reference this PR after it lands.

`src/types/session.ts` already scaffolded the frontend types when PR #94 was initially proposed, so the frontend type change is literally just a comment update.

## Commit structure

Three reviewable commits, analogous to `feat/use-fresh-plugin-data`:

1. **docs**: this plan file
2. **feat(chat-index)**: `server/chat-index/*` + unit tests (no wiring yet — server/client untouched so tests can land green on their own)
3. **feat(sessions)**: wire the indexer into the agent `finally` hook, update `server/routes/sessions.ts` to join the manifest, update `src/App.vue` to render the second line, update the comment in `src/types/session.ts`

## Summarizer specifics (cherry-picked from PR #94)

The PR #94 summarizer is reused mostly verbatim:

```ts
const args = [
  "--print",
  "--no-session-persistence",
  "--output-format", "json",
  "--model", "haiku",
  "--max-budget-usd", "0.05",
  "--json-schema", JSON.stringify(SUMMARY_SCHEMA),
  "--system-prompt", SYSTEM_PROMPT,
  "-p", input,
];
spawn("claude", args, { cwd: tmpdir(), stdio: ["ignore", "pipe", "pipe"] });
```

Key behaviours preserved:

- `cwd: tmpdir()` so project `CLAUDE.md` / plugins / memory do **not** inflate the summarization context
- `extractText` skips tool results and keeps only user / assistant text turns
- `truncate` keeps first 3000 + last 5000 chars for long sessions
- `--max-budget-usd 0.05` caps per-call spend
- Output is strict JSON schema `{ title, summary, keywords }`; validation rejects missing fields

## Throttle design detail

```ts
const MIN_INDEX_INTERVAL_MS = 15 * 60 * 1000;

async function isFresh(id: string): Promise<boolean> {
  try {
    const raw = await readFile(perSessionPath(id), "utf-8");
    const entry: ChatIndexEntry = JSON.parse(raw);
    const age = Date.now() - Date.parse(entry.indexedAt);
    return age < MIN_INDEX_INTERVAL_MS;
  } catch {
    return false;
  }
}
```

Rationale: PR #94's sha256-based staleness check was designed for a batch scanner — it answered "has this session changed since last index?". In the per-session trigger design the answer is almost always "yes" (we fire on every session end), so sha comparison adds no value. A wall-clock throttle is simpler and directly answers the question we actually care about: "did we spawn claude too recently on this session?"

## Tests

Unit tests only — no integration test spawning real `claude`.

**test_summarizer.ts** — pure helpers:

- `extractText` skips tool results, keeps user/assistant text, handles malformed lines
- `truncate` passes short text unchanged, truncates long text with ellipsis marker
- `parseClaudeJsonResult` handles error envelope, malformed json, success
- `validateSummaryResult` rejects non-objects, missing fields, coerces arrays

**test_indexer.ts** — `indexSession` with a stubbed `summarize`:

- Happy path: writes per-session file + manifest, entry fields match
- Freshness skip: if per-session file is < 15 min old, summarize is not called
- Forced reindex: stale per-session file is rewritten
- Manifest upsert: existing entry for same id is replaced, sort order preserved (newest `startedAt` first)
- Summarizer throws: no per-session file written, manifest unchanged

**test_index.ts** — `maybeIndexSession`:

- Skips when `sessionId` is in `activeSessionIds` (session still being written by a concurrent request)
- In-process lock: second call while first is running returns immediately
- `ClaudeCliNotFoundError` sentinel disables the module for the rest of the process lifetime

All tests use `mkdtempSync` to redirect `workspacePath` to a temp directory so real `~/mulmoclaude` is untouched. Mirrors the pattern in `test/journal/`.

## Acceptance criteria

- [ ] Starting the server and running a session end-to-end produces `~/mulmoclaude/chat/index/<id>.json` and `manifest.json` with a non-empty title + summary
- [ ] Reopening the sidebar history pane shows the AI-generated title for indexed sessions and the first-user-message fallback for non-indexed ones
- [ ] Indexed sessions render a second smaller grey line showing the summary
- [ ] Running 2+ turns in the same session within 15 min does **not** spawn claude each time (check via log / count of files in `~/.cache/claude/` or similar)
- [ ] `claude` CLI missing → server still serves `/api/sessions` correctly with fallback previews, no stack traces in logs
- [ ] `yarn format / lint / typecheck / build / test` all green
- [ ] New unit tests cover summarizer helpers, indexer logic, and `maybeIndexSession` lock/sentinel

## Out of scope (deferred or declined)

- `searchChatHistory` MCP tool — declined per the journal-supersedes argument above
- Startup backfill env var — defer; lazy backfill is probably sufficient
- Keyword display in the sidebar — `keywords` is stored but not rendered (future PR could add chip-style filters)
- Per-session reindex button in the sidebar — future PR
- Manifest sharding — the manifest stays flat. Probably fine until thousands of sessions, reconsider then.
