# refactor: single-source toUtcIsoDate into @mulmoclaude/common

Closes #2480.

## Problem

`toUtcIsoDate` (`Date` → `YYYY-MM-DD` in UTC) exists in 3 copies (Code Scanning
alert #261 flags the first pair; the duplicates table in `docs/shared-utils.md`
lists all three):

| File                                        | Note                                                             |
| ------------------------------------------- | ---------------------------------------------------------------- |
| `server/utils/date.ts`                      | host original                                                    |
| `packages/plugins/x-plugin/src/internal.ts` | byte-identical mirror ("Mirrors server/utils/date.ts")           |
| `packages/scheduler/src/date.ts`            | `@receptron/task-scheduler` — independently published leaf       |

At #2461 triage the x-plugin copy was KEEP because x-plugin was deliberately
zero-dependency. #2467 added `@mulmoclaude/common: ^1.1.0` to x-plugin
(errorMessage single-sourcing), so that rationale is gone — the pure function
rides the same dependency.

## Drift check

Host and x-plugin bodies are byte-identical. The scheduler copy differs only in
identifier names (`ts`/`y`/`m`/`d` vs `timestamp`/`year`/`month`/`day`) — no
behavioural drift anywhere.

## Plan

1. Add `toUtcIsoDate` to `@mulmoclaude/common` `src/index.ts` (same placement
   policy as `errorMessage` — root entry, no new subpath, exports map
   untouched). No version bump — common already has an unpublished `1.1.0`
   pending (npm latest is `1.0.0`); this rides the same next publish.
2. `server/utils/date.ts`: import from common and re-export, so the ~2 host
   import sites (`workspace/tool-trace/writeSearch.ts`) keep their surface —
   the `resolveWithinRoot` pattern from #2461 (`server/utils/files/safe.ts`).
   Other exports (`toLocalIsoDate`, `isoDateOnly`, `isValidIsoDate`) untouched.
3. x-plugin: delete the local copy in `internal.ts`; `client.ts` imports
   `toUtcIsoDate` from `@mulmoclaude/common` (alongside `errorMessage`).
   Header comment updated: `date` dropped from the ported-files list,
   `toUtcIsoDate` added to the carve-out that already names `errorMessage`.
4. `packages/scheduler/src/date.ts`: **KEEP** (per the issue comment) —
   `@receptron/task-scheduler` is an independently published, dependency-free
   leaf; a common dep for one 6-line pure function isn't worth it. Recorded as
   deliberate in the `docs/shared-utils.md` duplicates table (rule 6).
5. `docs/shared-utils.md`: new Time/Dates catalog row for the common helper;
   `server/utils/date.ts` row updated to name the re-export; duplicates-table
   `toUtcIsoDate` row rewritten (canonical + deliberate scheduler copy).

## Tests

`packages/common/test/test_date.ts`: UTC year-end boundary
(`2025-12-31T23:59:59.999Z` → `2025-12-31`, an instant that is already Jan 1
at positive local offsets), first instant of the UTC year, single-digit
month/day zero-padding, epoch. Verify-by-break: dropping the month `padStart`
turned 3 tests red; restored green.

## Verification

- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
- jscpd (workflow flags): the `internal.ts` ↔ `date.ts` clone pair (alert #261)
  gone, no new clones.
