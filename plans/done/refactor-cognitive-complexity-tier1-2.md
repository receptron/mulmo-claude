# Refactor: reduce sonarjs/cognitive-complexity warnings (Tier 1 + Tier 2)

Tracks: receptron/mulmoclaude#124

## Goal

`yarn lint` reports 13 `sonarjs/cognitive-complexity` warnings (threshold 15) on the server side. This PR refactors **8 of them** (Tier 1 + Tier 2) to bring complexity below the threshold **without changing behavior**, and extracts pure helpers into testable modules with unit tests.

The remaining 5 are deferred — see "Out of scope" below.

## Refactor philosophy

For each function, the same playbook:

1. **Read the function carefully**, identify branches, mutations, side effects
2. **Find the pure logic kernel** — the parts that take inputs and return outputs without I/O, mutation, or globals
3. **Extract that kernel** into a separate module under `server/<feature>/<helper>.ts` (or similar)
4. **Replace the original block** with a call to the extracted helper
5. **Write unit tests** for the extracted helper covering happy path + edge cases
6. **Re-run `yarn lint`** to verify the warning is gone and no new ones appeared
7. **Re-run `yarn test`** to verify nothing broke

Behavior preservation is non-negotiable. When in doubt, prefer a smaller-step extraction that obviously preserves semantics over a clever rewrite.

## Triage

### Tier 1 — Easy & High Impact

| # | Function | Current | Target | Strategy | Tests |
|---|---|---:|---:|---|---|
| 1 | `router.post("/scheduler")` | 30 | ~15 | Extract 5 case handlers as pure functions, dispatch via map | Per-case input → output |
| 2 | `router.post("/todos")` | 26 | ~14 | Extract 7 case handlers + `findTodoByText()` pure helper | Per-case + finder |
| 3 | `server/index.ts` IIFE | 23 | ~12 | Extract `sandboxSetup()` / `logMcpTools()` | None (pure orchestration around side-effectful boot) |
| 4 | `buildIndexMarkdown` | 17 | ~11 | Extract section renderers (`renderTopicsSection`, `renderDailySection`) | Each renderer as pure str→str |

### Tier 2 — Medium

| # | Function | Current | Target | Strategy | Tests |
|---|---|---:|---:|---|---|
| 5 | `runAgent` (`server/agent/index.ts`) | 24 | ~16 | Extract `buildSpawnArgs()` / `buildSpawnEnv()` / `buildMcpConfig()` | Builders as pure |
| 6 | `walkDailyFiles` (`server/workspace/journal/index.ts`) | 21 | ~14 | Flatten nested readdir loops, extract `parseDailyFilename()` pure | Filename parser |
| 7 | `runOptimizationPass` | 18 | ~12 | Extract `applyMerges()` / `applyArchives()` as pure (state, ops) → state | Each transform |
| 8 | `router.post("/wiki")` | 21 | ~13 | Extract `lint_report` case as separate function inside the file | None (kept behind I/O) |

### Tier 3 — Out of scope (separate follow-up)

| Function | Current | Reason |
|---|---:|---|
| `lint_report` case (`wiki.ts:147`) | 55 | Doable but large; separate PR for reviewer focus |
| `loadSessionExcerptsByDate` (`dailyPass.ts:313`) | 18 | Defer with the rest of journal pass cleanup |
| `runDailyPass` (`dailyPass.ts:74`) | 54 | I/O + mutation + branching tightly coupled, high regression risk |
| `extractJsonObject` (`archivist.ts:359`) | 23 | Already optimally decomposed (balanced-brace scanner is inherently stateful) |
| `compareTopicsNewestFirst` (`indexFile.ts:94`) | 16 | Comparator is dense but correct & stable; trivial helpers would hurt readability |

## Test placement

New unit tests under `test/` mirroring source layout:

- `test/routes/test_schedulerHandlers.ts`
- `test/routes/test_todosHandlers.ts`
- `test/journal/test_indexFileRenderers.ts`
- `test/agent/test_runAgentBuilders.ts`
- `test/journal/test_walkDailyFiles.ts`
- `test/journal/test_optimizationPassTransforms.ts`

Each new helper file lives next to its caller, so tests import from the source path. No new directories outside `test/` mirror that.

## Workflow

For each function:
1. Read the source
2. Implement the extraction (source change + new helper module)
3. Add tests for the new helper
4. `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
5. If anything fails, fix before moving on

Single PR for all 8. If a function turns out to be harder than expected during implementation, document why and skip it (move to Tier 3).

## Expected result

- Warnings: **18 → 8** (10 resolved)
- New tests: ~30–50 unit tests across the new helpers
- Behavior: unchanged
- Touched files: ~16 source + ~6 new test files
