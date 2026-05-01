# Memory storage wire-up (PR-B of #1029)

PR-A (#1058) landed the storage utilities (schema / IO / migration as a
library). PR-B wires them into runtime: workspace init ensures the dir,
server startup kicks off a one-shot migration, and the agent prompt
moves to the typed format on both read and write sides — atomically, so
the workspace never sits in a state where the agent reads from one
layout and writes to another.

## Scope (this PR)

- `server/workspace/memory/llm-classifier.ts` — wraps a `Summarize`
  callback into a `MemoryClassifier`. Asks Claude to classify each
  candidate into one of `preference / interest / fact / reference`
  and produce a one-line description. Returns null on parse failure
  so migration counts the entry as skipped.
- `server/workspace/workspace.ts` — ensure `conversations/memory/`
  exists; drop the auto-create of legacy `conversations/memory.md`.
- `server/index.ts` — call `runMemoryMigrationOnce()` async after
  init, fire-and-forget. Idempotent: only does work if the legacy
  file is present and the new dir is empty (besides MEMORY.md). On
  Claude CLI absent, log + skip.
- `server/agent/prompt.ts`:
  - `SYSTEM_PROMPT`: workspace section moves the bullet from
    `conversations/memory.md` to `conversations/memory/`.
  - `## Memory Management` section: rewrite to instruct the agent
    to create `conversations/memory/<slug>.md` with frontmatter
    (`name / description / type`) and update `MEMORY.md`. The 4
    type values are listed with examples so the LLM knows when to
    pick which.
  - `buildMemoryContext`: switch reader to a *union* — new entries
    plus the legacy file if still present. The legacy fallback
    keeps the user's facts visible during the brief window between
    "code shipped" and "migration done."

## Tests added

- `test_llm-classifier.ts`: happy parse, malformed JSON tolerance,
  unknown type rejected, schema-valid + missing description.
- `test_memory_context.ts`: dual-mode reader — legacy only / new
  only / both / neither.
- `test_workspace.ts`: `initWorkspace` now creates `memoryDir` and
  no longer auto-creates the legacy `memory.md`.

## Out of scope

- Index auto-regeneration on file change (covers human edits via
  file explorer; needed once #1032 lands) — phase 2.
- /memory UI (#1032), expiration (#1033), tags (#1034), proactive
  recall (#1035).
- A retry / progress indicator for migration. The fire-and-forget
  design assumes a one-time, idempotent run; if the user kills the
  server mid-migration, the next start retries the remaining
  entries. We log enough to debug.

## Migration concurrency note

After init, the agent can start serving requests before migration
completes. The window during which the agent might silently-append a
new typed file while migration is also writing typed files is small.
Both writes go through `writeFileAtomic({ uniqueTmp: true })` so the
file-level race is safe. A slug collision is theoretically possible
but unlikely in practice — slugify is deterministic and the agent's
silent-append picks a fresh slug from the new fact's name. Worst case
the later write wins on the colliding slug; we accept this.

## Failure modes

- **Claude CLI not found**: migration logs warn + skips. Legacy
  `memory.md` stays in place, reader continues to read it. User can
  install the CLI and restart to retry.
- **LLM returns garbage**: classifier returns null per entry, that
  entry is counted as `skippedByClassifier`. The remaining entries
  still migrate. The legacy backup is created at end of run so the
  user can re-process the skips manually.
- **Filesystem write error**: counted in `writeErrors`, migration
  continues to next entry.

## Design alternatives considered

- **Heuristic classifier (no LLM)**: faster and dependency-free, but
  user-confirmed preference for LLM-based for accuracy. The cost
  (~$0.15 once for a 137-line legacy file) is acceptable.
- **Sync migration in `initWorkspace`**: blocks startup for ~minutes;
  bad UX. Async fire-and-forget is preferred.
- **Block agent traffic until migration done**: too restrictive for
  a one-time event. The brief race window is accepted.
