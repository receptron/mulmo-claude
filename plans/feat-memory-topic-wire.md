# Memory topic-based wire-up (PR-B of #1070)

PR-A (#1072) landed the storage utilities (schema / IO / clusterer /
staging migration / swap helper). PR-B wires them into runtime:

- server startup kicks off a one-shot cluster migration if the
  workspace is still in #1029 atomic format
- the migration auto-swaps once staging is ready, so `memory.next/`
  is short-lived in practice; the user does not have to run anything
  manually
- agent prompt builds for the active format (topic or atomic),
  detected at request time
- a `yarn memory:swap` script remains as a manual fallback for
  failure recovery and for users who want to hand-edit the staging
  tree before promoting it

The atomic format isn't deleted on swap — it's parked under
`memory/.atomic-backup/<ts>/` so a misclassified cluster can be
recovered by hand without losing data. The user gets transparent
auto-migration with a safety net.

## Scope (this PR)

- `server/workspace/memory/topic-run.ts` — `runTopicMigrationOnce()`
  entry point. Idempotent: skips when (a) the workspace already
  uses the topic format (subdirs exist), (b) staging already
  exists, (c) no atomic entries to migrate, (d) the legacy
  `memory.md` flag from #1029 is still in flight (we don't want to
  trip over an in-progress legacy migration). Calls
  `clusterAtomicIntoStaging` with the production LLM clusterer.
- `server/index.ts` — fire-and-forget call to
  `runTopicMigrationOnce(workspacePath)` after init, mirroring the
  pattern from #1029 PR-B.
- `server/agent/prompt.ts`:
  - `buildMemoryContext`: detects the active format and branches.
    If `<type>/` subdirs exist under `conversations/memory/`, load
    via `loadAllTopicFilesSync` and emit the topic-shaped context
    (one block per file: H1 + index of H2 sections + body). If
    only atomic entries exist, fall through to the existing
    atomic + legacy-memory.md union reader.
  - Memory Management section: same detection, conditionally
    emits the topic-format instructions (write
    `<type>/<topic>.md`, append bullets under H2 sections, choose
    a topic from the existing list or create a new one) or the
    atomic-format instructions (existing #1029 PR-B prompt).
- A `yarn` script + thin CLI helper at
  `scripts/memory/swap-topic-staging.mjs` that calls
  `swapStagingIntoMemory(workspaceRoot)` and prints the result.
  This is the user's "I reviewed the diff, promote staging" trigger.
- Tests:
  - `topic-run`: skip paths (post-topic, staging present, no
    atomic entries) and the proceed path with a stubbed
    summarizer
  - `prompt`: format-detection branching in `buildMemoryContext`
    and the Memory Management section

## Out of scope

- Drop / archive the atomic format reader. As long as some users
  still have atomic format (post-PR-B but pre-swap) we keep dual
  read. Eventual atomic-format retirement is a separate followup.
- `/memory` UI (#1032), expiration (#1033), per-role tag loading
  (#1034), proactive recall (#1035).
- Index auto-regeneration on file change. Topic-format `MEMORY.md`
  is rebuilt during cluster migration; it's not maintained on
  every individual write yet. Once #1032's edit UI lands the index
  needs a hook.

## Race / failure modes

- **Cluster runs in background, agent serves traffic**: same race
  window as #1029 PR-B. The agent reads atomic (pre-swap) so its
  writes go to atomic format. After swap, agent prompt switches
  and writes go to topic format. There is no dual-write window.
- **User edits memory.next/ before swap**: user is encouraged to
  fix clusterer mistakes there. Edits survive into post-swap
  state because swap is just a rename.
- **Swap fails partway**: `topic-swap.ts` already rolls back the
  rename on partial failure (see PR-A).
- **User runs swap twice**: second run is a no-op because the
  staging dir is gone after the first swap.

## Detection signal

Active format = "topic" iff `<workspaceRoot>/conversations/memory/`
contains at least one of `preference/`, `interest/`, `fact/`,
`reference/` as a subdirectory. Otherwise format is "atomic" (the
PR-B of #1029 layout: flat `<type>_<slug>.md` files at the memory
dir root).

The detection is cheap (one stat per type) and runs each time
`buildMemoryContext` is called. There is no global flag — disk is
the source of truth so a manual swap immediately changes behavior
on the next request.

## CLI swap helper

A small `scripts/memory/swap-topic-staging.mjs` (or .ts) that:

1. Confirms `conversations/memory.next/` exists.
2. Calls `swapStagingIntoMemory(workspaceRoot)`.
3. Prints the result (paths, success / failure).

Exposed as `yarn memory:swap` in `package.json`.

## Tests

- `test/workspace/memory/test_topic_run.ts` — covers each skip
  path + proceed path with a stubbed summarizer.
- `test/agent/test_topic_memory_context.ts` — covers
  detection of topic vs atomic format and the right prompt /
  context output for each.

## Related

- #1029 (atomic format, completed)
- #1070 umbrella (this issue's parent)
- #1072 PR-A (storage utilities, completed)
- #1032 (edit UI — index auto-regen will hook here)
