# fix #3018 — the host-exec stdio shim never reaches the agent

Two independent defects, both in our code. Either one alone is enough to
produce the reported symptom, so both had to be fixed.

## Symptom

A stdio MCP server opted into `hostExecInDocker: true` never surfaces any tool in
an agent session, even though the shim logs `stdio→http shim ready` and
`/api/diagnostics/report` lists the server.

## Root cause

`server/agent/config.ts` rewrites the opted-in stdio spec to:

```ts
out[serverId] = { type: "http", url: rewriteLocalhostForDocker(shim.url, useDocker) };
//                       ^^^^ Streamable HTTP           shim.url = http://…/sse
```

but the shim starts `supergateway --stdio … --port N`, and supergateway's
`outputTransport` **defaults to `sse`** when `--stdio` is given. `stdioToSse`
registers `GET /sse` (stream) + `POST /message` — there is **no `POST /sse`**.

The Claude CLI treats `type: "http"` as Streamable HTTP and POSTs `initialize`
to the URL, so it hits `POST /sse` → 404 → the server never connects and
contributes zero tools.

Verified against a live shim (`supergateway@3.4.3` + a dummy stdio MCP):

| declared type | `mcp_servers` status | tools |
|---|---|---|
| `"http"` (current) | `failed` | `[]` |
| `"sse"` | `connected` | `["mcp__dummy__ping"]` |

`GET /sse` → 200 `text/event-stream`; `POST /sse` → 404.

Introduced in `06d73a766` (#1421 Phase B, 2026-05-18) and never changed, so the
`hostExecInDocker` opt-in has never worked for any server.

## Why it looked healthy

Both signals the reporter trusted are blind to the transport:

- `probeOnce()` declares readiness on `GET /sse` returning 200 — it validates the
  **SSE** endpoint while the caller labels the spec `http`. The probe itself
  proves the mismatch.
- `diagnostics/collect.ts` builds "MCP servers" from
  `Object.keys(loadMcpConfig().mcpServers)` — the **config file**, never a live
  connection.

## Defect 2 — the readiness probe eats the gateway's only session

Found while verifying defect 1 end-to-end: with the transport corrected the
server *still* failed, and the gateway process died on the agent's connect.

supergateway's `stdioToSse` keeps ONE MCP `Server` and calls `server.connect()`
on **every** `GET /sse`. The second connect throws inside an Express handler:

```
Error: Already connected to a transport. Call close() before connecting to a
new transport, or use a separate Protocol instance per connection.
    at Server.connect (…/sdk/shared/protocol.js:217)
    at supergateway/dist/gateways/stdioToSse.js:58
```

Unhandled → the gateway exits, and with it the host stdio process.

`probeOnce()` opened `GET /sse` and never released it, so the probe consumed
the only session and **the agent's connect was always the fatal second one**.

Measured against a real MCP server (`@modelcontextprotocol/server-memory`):

| probe strategy | probe result | agent connect | gateway |
|---|---|---|---|
| `GET /sse`, body unconsumed (shipped) | 200 | **fails** | **crashed** |
| `GET /sse`, body cancelled | 200 | **fails** | **crashed** |
| `POST /message` | 400 | **ok** | alive |

Cancelling the stream does not help: the gateway never calls `server.close()`,
so the SDK stays bound to the dead transport. The probe must not touch the
stream path at all. `POST /message` without a `sessionId` answers 400 from a
route that never reaches the `Server` — readiness proven, session preserved.

## Why `sse`, not `streamableHttp`

`--outputTransport streamableHttp` also connects, but changes process lifetime:

| gateway | `spawn()` site | stdio process lifetime |
|---|---|---|
| `stdioToSse` | function top level | **one per gateway** — matches non-Docker stdio |
| `stdioToStatelessStreamableHttp` (default) | inside `app.post` | **one per HTTP request** |
| `stdioToStatefulStreamableHttp` | inside `app.post` | one per session |

The shim exists to give "parity with the non-Docker stdio path", and stateless
Streamable HTTP would restart the MCP server on every tool call (a fresh IMAP
connect per call for #3018's email server). SSE preserves the intended
semantics, so the fix is to declare the transport the shim actually speaks.

## Change

0. `server/agent/stdioHttpShim.ts` — probe `POST /message` instead of
   `GET /sse`; split `shimSseUrl` (what the agent connects to) from
   `shimProbeUrl` (readiness), and pass `--ssePath` / `--messagePath` to
   supergateway explicitly so our constants describe the routes the process
   actually serves.
1. `server/system/config.ts` — add `McpSseSpec` and `PreparedMcpServerSpec`
   (`McpServerSpec | McpSseSpec`). **User config stays `http | stdio`**:
   `isMcpServerSpec` does not accept `sse`, so this adds no user-facing feature.
   `sse` is only ever produced internally by the shim path.
2. `server/agent/config.ts` — emit `type: "sse"`; widen the prepared-map types.
   Route the `/sse` path through one constant so the probe URL and the returned
   URL cannot drift again.
3. `server/agent/mcpHealth.ts` — widen `validateStdioPackages` to the prepared type.
4. Inject the shim starter into `prepareUserServers` so the **success path** is
   testable without spawning a host process.

## Tests

The success path had **no coverage** — `test_agent_config.ts` only asserted the
drop paths, which is why the mislabelled transport shipped. Add:

- opted-in stdio + a stub shim → emitted spec is `{ type: "sse", url: … }`
  (fails before the fix: it was `type: "http"`)
- the URL is rewritten to `host.docker.internal` and keeps the shim's path
- `userServerAllowedToolNames` still emits `mcp__<id>` for a shimmed server
- a fake gateway reproducing the single-`Server` contract: the probe reports
  ready, opens **zero** SSE streams, and the agent's subsequent connect still
  gets a live gateway (fails before the fix on "the probe must never open the
  SSE stream")
- the probe path and the advertised path differ

## Verification

End-to-end through the real `prepareUserServers` + real `startStdioHttpShim` +
real `claude` CLI, against `@modelcontextprotocol/server-memory`:

```
PREPARED {"memory":{"type":"sse","url":"http://host.docker.internal:39100/sse"}}
RESULT   mcp_servers=[{"name":"memory","status":"connected"}]
RESULT   tools=[9 × mcp__memory__*]
```

Both fixes were confirmed by reverting them individually and watching the new
tests go red.

## Out of scope (worth separate issues)

- The host never reads the CLI's `mcp_servers[].status`, so a failed MCP
  connection is invisible to the user. That is what made this silent.
- `/api/diagnostics/report` reports configured servers as if they were
  connected.
