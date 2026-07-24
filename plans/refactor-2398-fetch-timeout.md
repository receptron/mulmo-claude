# refactor(core): consolidate the 3 `fetchWithTimeout` implementations — #2398

## Problem

`fetchWithTimeout` (AbortController + timeout timer + caller-signal composition)
is implemented three times, verbatim:

| File | Origin |
|---|---|
| `server/utils/fetch.ts` | original (MCP bridge) |
| `packages/core/src/collection/registry/server/fetch.ts` | "ported from the host" |
| `packages/core/src/google/fetch.ts` | "same convention" |

jscpd's largest clone (249 tokens × 2 pairs). #2221 fixed a bug where the helper
silently overwrote a caller-supplied `signal`; with three copies the fix can only
ever land in one — timeout/abort composition is a network-reliability primitive
where drift is expensive.

## 3-way diff (reconciliation)

The three `fetchWithTimeout` bodies are byte-identical in behaviour:
- same `DEFAULT_FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS`
- same `FetchWithTimeoutInit = Parameters<typeof fetch>[1] & { timeoutMs?: number }`
- same pre-abort check, timer, `bridgeExternalSignal` composition, finally-cleanup

Differences are only in surrounding material, NOT the shared unit:
- `server/utils/fetch.ts` additionally exports `extractFetchError(res)` (host-only,
  parses `{ error }` bodies from `/api/*`). **Stays in the host file.**
- Each copy imports `ONE_SECOND_MS` from a different neighbour (`./time`,
  `../../server/util`, `./util`). The canonical file defines its own local
  `ONE_SECOND_MS` const (core has no central time module; `google/util.ts` and
  `collection/server/util.ts` already each define their own — that duplication is
  out of scope here).
- Comment wording differs slightly; the load-bearing comments (the
  `Parameters<typeof fetch>[1]` no-undef rationale, the pre-abort rationale) are
  preserved in the canonical file.

## Plan

1. Canonical impl → `packages/core/src/utils/fetch.ts` exporting
   `DEFAULT_FETCH_TIMEOUT_MS`, `FetchWithTimeoutInit`, `fetchWithTimeout`.
   Keep the `Parameters<typeof fetch>[1]` trick + `no-undef` comment (load-bearing).
2. Expose on a new server-only subpath `@mulmoclaude/core/fetch`
   (package.json `exports` + vite entry `utils/fetch`).
3. Delete the two core copies; repoint their 5 internal consumers
   (`collection/registry/server/{client,collectionFiles}.ts`,
   `google/{broker,apiClient,auth}.ts`) to import `fetchWithTimeout` from the
   canonical relative path. Neither copy was re-exported by an index, and only
   `fetchWithTimeout` was consumed — no public surface change inside core.
4. `server/utils/fetch.ts` → re-export `fetchWithTimeout`, `DEFAULT_FETCH_TIMEOUT_MS`,
   `FetchWithTimeoutInit` from `@mulmoclaude/core/fetch` (mirrors the existing
   `server/utils/errors.ts` / `text.ts` pattern) and keep `extractFetchError`.
   `server/agent/mcp-server.ts` (`{ extractFetchError, fetchWithTimeout }`) keeps working.

## Tests

- New canonical suite `packages/core/test/utils/test_fetch.ts` importing the core
  SOURCE (`../../src/utils/fetch.ts`) so mutation checks bite without a rebuild:
  already-aborted caller signal (throws before network), timeout fires
  (`TimeoutError`), caller signal aborts mid-flight, happy path, default timeout,
  and the #2221 regression (caller signal composed, not overwritten).
- Host `test/utils/test_fetch.ts` keeps the `extractFetchError` suite; the
  `fetchWithTimeout` coverage moves to core (host still re-exports it).
- Verify-real: drop the pre-abort check in the canonical impl, confirm the
  "already aborted" + "#2221 composition" tests go RED, restore.

## Version / range impact

New public subpath `@mulmoclaude/core/fetch`, consumed only by the host in-repo.
Bump `@mulmoclaude/core` patch→minor (new export surface) and the launcher's dep
range per CLAUDE.md `launcherSync` invariant. Reasoning recorded in PR.
