# Atomic writes v2 of #881

GitHub: https://github.com/receptron/mulmoclaude/issues/881
Continues from PR #885 (v1 = HIGH 6 sites, merged).

## Scope (v2 — MEDIUM 4 sites in the issue, 3 in this PR)

| Site | Action |
|---|---|
| `server/api/routes/mulmo-script.ts:621, 693` | Replace `writeFileSync(path, Buffer)` with `await writeFileAtomic(path, Buffer)`. Both are inside async route handlers, so unblocking is fine. Drop the now-redundant `mkdirSync(path.dirname(...), { recursive: true })`. |
| `server/workspace/tool-trace/writeSearch.ts:90` | Change the default `writeFile` deps adapter from `fsp.writeFile(...)` to `writeFileAtomic(...)`. Tests inject their own adapter so behaviour stays mockable. |
| `server/utils/files/json.ts:saveJsonFile` | Zero production callers (only test files reference it). Remove the function + its barrel re-export, migrate the existing tests to `writeJsonAtomic`. |

## Out of scope

- **`server/workspace/wiki-backlinks/index.ts:42,97`** — owned by **PR #883** (`refactor(wiki): consolidate page writes into writeWikiPage choke point`). #883 will route every wiki page write through a single helper, including the backlinks adapter, so duplicating that work here would just create a merge conflict.
- LOW (append-only) sites — logger / session-io / source archive / tool-trace JSONL append. Different correctness model (append-only doesn't have the half-write problem the same way).
- Migration scripts (`scripts/migrate-*`) — one-shot, user-invoked.

## Verification

- `yarn typecheck / lint / format / build / test` clean
- `grep` over the touched files: zero remaining `writeFile` / `writeFileSync` / `fsp.writeFile` outside of intentional cases
- Unit tests for the new `writeJsonAtomic` migration path stay green (the pre-existing tests already cover the atomic semantics)

## Why split from PR #885

PR #885 was already a meaningful slice (atomic + Buffer widening + 6 stores). Adding the v2 sites would have buried two unrelated kinds of change in one diff — the deps-adapter swap and the route-handler sync→async conversion. Keeping v2 separate makes review easier and unblocks #883's wiki work cleanly.
