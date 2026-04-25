# Journal subsystem audit (#799)

**Status**: audit + roadmap, not yet implemented
**Tracks**: #799
**Owner**: TBD
**Last updated**: 2026-04-25

A retrospective on the `server/workspace/journal/` subsystem, which
has accreted feature-by-feature since the original auto-journal
design (`plans/done/feat-auto-journal.md`). The goal is to (1) write
down the current spec while it's still in working memory, (2) flag
the smells that have built up, and (3) sequence cleanup work into
risk-ordered PRs.

## What journal does today

The subsystem auto-distils session logs into browseable daily and
topic summaries. session-end calls `maybeRunJournal()` fire-and-
forget; the function gates by interval, holds a single-process
in-flight lock, and silently disables itself if the `claude` CLI is
missing.

Three independent pipelines run from the same entry point:

```
session-end
  └─> maybeRunJournal()
        ├─> daily pass (≥ 1h since last)        — dailyPass.ts
        ├─> optimization pass (≥ 7d since last) — optimizationPass.ts
        └─> memory extractor (end of daily)     — memoryExtractor.ts
```

### Daily pass

`runDailyPass()` finds new/changed sessions via mtime, groups events
by **local** date, invokes the `claude` CLI once per day with
session excerpts, writes:

- `summaries/daily/YYYY/MM/DD.md` (one per day)
- `summaries/topics/<slug>.md` (created or appended)
- `summaries/_index.md` (rebuilt)
- `_state.json` (post-day checkpoint — crash safety)

### Optimization pass

`runOptimizationPass()` weekly. Reads existing topics, asks the LLM
to merge duplicates / archive stale ones, writes back changed
topics and to `summaries/archive/topics/`.

### Memory extractor

End of daily pass: scans the new daily file for memory-worthy
facts, appends to `~/.claude/memory.md` (user's global memory).

### State

`_state.json` records per-session ingest mtimes and known topic
slugs. Schema versioned via `JOURNAL_STATE_VERSION`; mismatch
triggers a silent rebuild on next run (Problem G below).

### Link rewriting

Summary text comes back from the LLM with workspace-absolute links
(`/wiki/foo.md`); `rewriteWorkspaceLinks` / `rewriteMarkdownLinks`
convert to true-relative paths before disk write so the UI can
follow them. The `linkRewrite.ts` file in journal is a 4-line pure
re-export of the shared helpers in `server/utils/markdown.js`.

## File inventory

| File | Lines | Concerns |
|---|---|---|
| `dailyPass.ts` | 746 | God function — Phase 1–4 + 19 local helpers |
| `archivist.ts` | 386 | Schemas + prompts + CLI subprocess wrapper |
| `index.ts` | 185 | Entry + lock + disable flag + interval gate |
| `optimizationPass.ts` | 160 | Weekly merge / archive |
| `indexFile.ts` | 140 | Rebuilds `_index.md` |
| `memoryExtractor.ts` | 130 | Appends to memory.md |
| `state.ts` | 125 | `_state.json` parse / write |
| `diff.ts` | 71 | Topic diff for log lines |
| `paths.ts` | 60 | Path helpers |
| `linkRewrite.ts` | 4 | Vestigial re-export |

Tests under `test/journal/` mirror the structure 1:1 (12 files,
1,998 lines). Coverage is good for pure helpers; integration paths
through `maybeRunJournal()` are exercised informally.

## Problems / smells

### A — Vestigial `linkRewrite.ts` (4 lines)

**Where**: `server/workspace/journal/linkRewrite.ts:1`

Pure re-export of two functions from `server/utils/markdown.js`.
Adds a layer of indirection with no benefit.

**Fix**: delete; update the two callers (`dailyPass.ts`,
`optimizationPass.ts`) to import directly. **0.5 h.**

### B — God function `runDailyPass()` (~746 lines in one file)

**Where**: `server/workspace/journal/dailyPass.ts`

The phase comments (Phase 1–4) hint at distinct responsibilities:
plan building, day bucketing, LLM calls, memory extraction. They
all live in one function with 19 closures.

**Fix**: extract Phase 1–2 into a pure `buildDailyPassPlan()` that
returns a `{ dirtySessions, dayBuckets }` plan object. The main
loop becomes orchestration; the planner is independently testable.

**1.5–3 h.** Med risk — touches the largest file but logic is
already well-factored, just needs separation.

### C — Module-level mutable state

**Where**: `server/workspace/journal/index.ts:running`,
`server/workspace/journal/index.ts:disabled`

Two booleans guard concurrent invocation and feature disable.
Single-thread JS makes this safe today, but it relies on an
implicit constraint.

**Fix**: docstring noting the single-process / single-user
assumption + a pointer to where to revisit if that changes.
**0 h** (docs only).

### D — Pass naming overlap

`dailyPass` / `optimizationPass` / `memoryExtractor` look like
peers but have different cadences and outputs. The index is
implicit — readers grep around to figure it out.

**Fix**: top-of-file diagram in `index.ts` showing the three
pipelines, their cadence, what they read/write. **0.5 h.**

### E — `archivist.ts` is a hotel for LLM contracts

386 lines hosting:

- 6 large interfaces (`SessionExcerpt`, `DailyArchivistOutput`, …)
- 3 system prompts
- 2 user-prompt builders
- The `runClaudeCli` subprocess wrapper

Cross-imported by `dailyPass.ts`, `optimizationPass.ts`, tests.

**Fix**: split to `archivist-cli.ts` (Summarize type, runClaudeCli,
errors) + `archivist-schemas.ts` (interfaces, prompts, validators).
**1 h.** Pure refactor.

### F — Crash-safety claim isn't tested

Code comments around `dailyPass.ts:106-107` describe per-day
checkpointing as crash-safe. No integration test exercises the
"write state, then kill, then resume" path.

**Fix**: integration test that writes a few days, corrupts state
mid-pass, re-runs and asserts correct continuation. **1–2 h.**
Not blocking — comments + manual test are reasonable for now.

### G — Silent state-version reset

**Where**: `server/workspace/journal/state.ts:66`

When `JOURNAL_STATE_VERSION` bumps, `parseState()` discards old
state and re-ingests all sessions. The user sees a re-processing
event with no log line explaining why.

**Fix**: `log.info("journal", "state version mismatch, resetting")`
in the reset branch. **0.25 h.**

### H — `maybeRunJournal()` lacks unit tests

Lock-holds-concurrent-calls, disable-after-ENOENT, force-flag
override are all relied on but only exercised informally /
manually.

**Fix**: mock-heavy test with fake state + summarizer. **1 h.**

## Refactor / improvement / deletion candidates

Sorted by impact-to-effort ratio:

| Tier | Item | Cost | Notes |
|---|---|---|---|
| 🟢 quick | Delete `linkRewrite.ts` | 0.5 h | Pure cleanup, low risk |
| 🟢 quick | State-version-reset log line | 0.25 h | Single-line, aids ops |
| 🟢 quick | `index.ts` architecture docstring | 0.5 h | High clarity payoff |
| 🟡 med | Extract `buildDailyPassPlan()` | 2–3 h | Largest file, but well-factored |
| 🟡 med | Split `archivist.ts` | 1 h | Clean separation |
| 🔵 opt | Crash-recovery integration test | 1–2 h | Defends the comment |
| 🔵 opt | `maybeRunJournal()` unit tests | 1 h | Edge-case coverage |

## Ideas — not in this audit's scope

Forward-looking items worth their own issues if anyone bites:

- **journal browser** — `/journal` page with date / topic filters.
  The summary corpus already exists; just needs UI.
- **retention policy** — `summaries.retentionDays` knob;
  periodically archive/delete old daily entries.
- **topic pinning** — `pin: true` in state so optimizer never
  merges/archives a user-anchored topic.
- **memory cross-links** — auto-`see also: memory:L23` when a
  topic mentions a fact already in `memory.md`.
- **topic preview cache** — cache first ~200 chars per topic in
  state so `_index.md` rebuild doesn't re-read every topic file.

## Recommended PR sequence

### PR1 — cleanup + docs (0.5–1 day)

- Delete `linkRewrite.ts`, inline imports.
- Add state-version-reset log line.
- Add `index.ts` architecture docstring.

Risk: minimal. No behaviour change.

### PR2 — extract `buildDailyPassPlan()` (1–2 days)

- Pure planner: input = session metas, output = `{ dirtySessions,
  dayBuckets }`.
- `runDailyPass()` becomes orchestration.
- Unit-test the planner in isolation.

Risk: medium. Largest file, but the cut-line follows existing phase
comments.

### PR3 — archivist split (optional, ~1 day)

- `archivist-cli.ts`: Summarize type, runClaudeCli, errors.
- `archivist-schemas.ts`: interfaces, prompts, validators.
- Update imports in callers + tests.

Risk: low. Pure refactor.

### PR4 — edge-case tests (optional, ~1 day)

- `maybeRunJournal()` unit tests (lock / disable / force).
- Mid-pass crash recovery integration test.

Risk: low. Tests only.

## Effort summary

| Path | Effort |
|---|---|
| Essential (PR1 + PR2) | 1.5–2 days |
| All four PRs | 3–4 days |

## Out of scope

- New journal-facing user features (browser, retention, pinning,
  cross-links) — see "Ideas" above; each gets its own issue if
  someone wants to drive it.
- Changing the LLM contract (different prompts, different output
  schema) — orthogonal to the cleanup work.
- Replacing the `claude` CLI subprocess with the SDK — explicitly
  rejected in the original design (`feat-auto-journal.md`) so SDK
  tokens aren't burned on this background task.
