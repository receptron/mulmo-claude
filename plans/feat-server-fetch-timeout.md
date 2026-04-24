# Server-side fetch: add AbortController / timeout (#722)

## Goal

Give every raw `fetch()` in the server-side MCP bridge and agent tools a
finite timeout so a hung peer (Express host busy, DNS failure, X API
stall) can no longer leave the caller blocked indefinitely. MCP tool
calls should fail fast with an explicit error instead of waiting out
the MCP client's own 30–60 s tool-call timeout.

## Non-goals

- No changes to Vue / `src/utils/api.ts` — the frontend already has
  `apiGet` / `apiPost` with AbortController. This issue is server-side
  only.
- No generic retry policy. Timeout + surface the error; retry is the
  caller's responsibility.
- Not collapsing the existing `httpFetcher.ts` fetcher into the new
  helper. `httpFetcher` has extra concerns (rate limiter, robots.txt,
  manual redirects) and is scoped to the RSS/sources pipeline — it
  stays. The new helper is a thin, general-purpose utility.

## Scope

Rewrite the five call sites listed in #722:

| Site | Purpose | Timeout |
|---|---|---|
| `server/agent/mcp-server.ts:146` (`postJson`) | POST to localhost `/api/*` routes from the MCP bridge | 10 s default |
| `server/agent/mcp-server.ts:180` (`fetchSkillsList`) | GET `/api/skills` from the MCP bridge | 10 s default |
| `server/agent/mcp-server.ts:241` (skills update) | PUT `/api/skills/:name` | 10 s default |
| `server/agent/mcp-server.ts:264` (skills delete) | DELETE `/api/skills/:name` | 10 s default |
| `server/agent/mcp-tools/x.ts:42` (`fetchX`) | External GET to `api.twitter.com` | 20 s override — X stalls under rate limit |

## Design

Add `fetchWithTimeout` to `server/utils/fetch.ts` (same module as the
existing `extractFetchError`):

```ts
import { ONE_SECOND_MS } from "./time.js";

export const DEFAULT_FETCH_TIMEOUT_MS = 10 * ONE_SECOND_MS;

export interface FetchWithTimeoutInit extends RequestInit {
  timeoutMs?: number;
}

export async function fetchWithTimeout(
  url: string | URL,
  init: FetchWithTimeoutInit = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal: callerSignal, ...rest } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException(`fetch timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);

  // If the caller passed their own signal, compose with ours so either
  // source of cancellation aborts the request.
  const unsubscribe = bridgeAbort(callerSignal, controller);

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    unsubscribe?.();
  }
}
```

`bridgeAbort` handles both the "already aborted" case (throws caller's
reason immediately) and live abort propagation, mirroring the pattern
already in `server/workspace/sources/httpFetcher.ts`.

## Call-site rewrite

Each site currently looks like:

```ts
let res: Response;
try {
  res = await fetch(url, { ... });
} catch (err) {
  throw new Error(`Network error calling X: ${errorMessage(err)}`);
}
```

The catch block already converts any thrown error (including future
`TimeoutError`) into a readable message — no extra handling needed at
the site. Just swap `fetch` → `fetchWithTimeout` and (for X API) pass
`timeoutMs: 20 * ONE_SECOND_MS`.

### Error message parity

`AbortError` / `TimeoutError` thrown by `AbortController.abort(reason)`
has `err.message === "fetch timed out after 10000ms"`, which flows
through `errorMessage(err)` in the existing catch. So the surfaced
error at each site will read e.g.
`Network error calling /api/skills: fetch timed out after 10000ms` —
self-descriptive enough for the MCP client.

## Testing

New unit test `test/utils/test_fetchWithTimeout.ts` covers:

- Happy path — completes before the timer fires, returns the response
- Timeout fires — rejects with a TimeoutError whose message contains
  the timeout value
- Timer cleanup on success — verify no pending timers leaked (the
  `finally` clause runs regardless)
- External signal — caller-provided signal aborts the fetch
- Already-aborted external signal — rejects immediately with the
  caller's reason

Uses `node:test` + `node:assert` per CLAUDE.md. Mocks `fetch` via a
custom `fetchImpl` parameter — **no**, we use global `fetch` with a
stub URL that never resolves (controlled with a deferred promise) to
exercise the timeout path without hitting the network.

## Side effects to flag

1. **Behaviour change** — hung requests that previously sat forever now
   reject after N ms. Existing `try/catch` blocks already wrap every
   call site, so the error propagates cleanly; no new unhandled
   rejection path.
2. **MCP-client alignment** — Claude Code's own tool-call timeout is
   30–60 s. Setting the server-side timeout to 10 s guarantees the
   MCP bridge returns a tool result (even an error one) before the
   client bails, which gives the LLM a chance to reason about and
   retry.
3. **X API under rate limit** — 10 s would cause false positives since
   `api.twitter.com` can legitimately take longer. 20 s override.
4. **No call site currently passes its own `signal`** — the caller-
   signal composition is forward-looking; no existing behaviour is
   affected.

## Rollout

Single PR, no feature flag needed. Small blast radius: only the five
listed sites change. Merge-commit per project convention.

## Follow-up opportunities (not this PR)

- Audit `packages/*/src/**` for raw `fetch` (out of scope — those are
  published npm packages and move independently).
- Consider extending `httpFetcher.ts` to re-use the new helper once the
  rate-limiter / robots-aware layer is factored out — currently they
  live in separate concerns.
