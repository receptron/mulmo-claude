# Server Logging

The MulmoClaude server has a small, dependency-free structured logger at
`server/system/logger/`. It writes to the console **and** to rotating files
under `server/system/logs/` by default, with independent configuration for
each sink.

Format, level, destination, and retention are all configurable via
environment variables — no code changes required to tune output for
development, debugging, or deployment.

## Defaults

Out of the box:

| Sink | Enabled | Level | Format | Destination |
|---|---|---|---|---|
| Console | yes | `info` | `text` | stdout (info/debug) + stderr (warn/error) |
| File | yes | `debug` | `json` | `server/system/logs/server-YYYY-MM-DD.log` (14-day retention) |
| Telemetry | no | `error` | `json` | *(stub, reserved for future)* |

The console stays human-readable while the file captures every
`debug`-level line as JSON Lines so you can `grep` / `jq` past
incidents. `server/system/logs/` is git-ignored.

## Formats

### Text (`format: "text"`)

```text
2026-04-13T07:12:45.123Z INFO  [agent] request received sessionId=abc roleId=general messageLen=42
2026-04-13T07:12:45.301Z ERROR [agent-stderr] claude: failed to resume stale session
2026-04-13T07:12:45.812Z INFO  [agent] request completed sessionId=abc durationMs=512
```

Fields: `<ISO-timestamp> <PADDED-LEVEL> [<prefix>] <message> [k=v ...]`

Strings with whitespace are auto-quoted; nested objects are serialized as JSON.

### JSON (`format: "json"`)

One JSON object per line (JSONL):

```json
{"ts":"2026-04-13T07:12:45.123Z","level":"info","prefix":"agent","message":"request received","data":{"sessionId":"abc","roleId":"general","messageLen":42}}
```

The `data` key is omitted when no structured payload was supplied.

## Log levels

`error` < `warn` < `info` < `debug` (lowest number = most severe).

A sink writes a record only if the record's level is at-or-above the
sink's configured threshold. So `level: "warn"` emits `error` and
`warn` but drops `info` and `debug`.

## Environment variables

All are optional; omitted values fall back to the defaults table above.

| Variable | Values | Applies to |
|---|---|---|
| `LOG_LEVEL` | `error` / `warn` / `info` / `debug` | **both** console + file (coarse knob) |
| `LOG_CONSOLE_LEVEL` | same | console only (overrides `LOG_LEVEL`) |
| `LOG_FILE_LEVEL` | same | file only (overrides `LOG_LEVEL`) |
| `LOG_CONSOLE_FORMAT` | `text` / `json` | console |
| `LOG_FILE_FORMAT` | `text` / `json` | file |
| `LOG_CONSOLE_ENABLED` | `true` / `false` / `1` / `0` / `yes` / `no` | console |
| `LOG_FILE_ENABLED` | same | file |
| `LOG_FILE_DIR` | directory path | file sink output directory |
| `LOG_FILE_MAX_FILES` | positive integer | rotation retention (default `14`) |
| `LOG_TELEMETRY_ENABLED` | boolean | telemetry sink (currently a no-op stub) |
| `LOG_TELEMETRY_LEVEL` | level | telemetry |
| `LOG_TELEMETRY_FORMAT` | `text` / `json` | telemetry |

Invalid values (e.g. `LOG_LEVEL=chatty`) are silently ignored — the
logger falls back to the default for that knob rather than crashing
on startup.

## Rotation

The file sink uses **daily rotation** keyed on UTC date:

- Each day's records go to `server-YYYY-MM-DD.log` under `LOG_FILE_DIR`.
- On rollover, the current file is closed and the oldest files beyond
  `LOG_FILE_MAX_FILES` are deleted.
- Retention is strictly name-based (our filenames are ISO-sortable),
  so unrelated files in the log directory are never touched.
- There is **no size-based rotation** — if a single day exceeds what
  you expect, lower the log level or set `LOG_FILE_ENABLED=false` and
  pipe stdout elsewhere.

## Common recipes

### Keep console quiet, preserve full history on disk

```bash
LOG_CONSOLE_LEVEL=warn yarn dev
```

Console shows only warnings/errors; the `server/system/logs/*.log` file still
captures every `debug` line.

### Console-only (no files)

```bash
LOG_FILE_ENABLED=false yarn dev
```

### File-only (silent console)

```bash
LOG_CONSOLE_ENABLED=false yarn dev
```

### Route logs to `/var/log/mulmoclaude`

```bash
LOG_FILE_DIR=/var/log/mulmoclaude LOG_FILE_MAX_FILES=30 yarn dev
```

### Ship JSON to stdout (e.g. for a log collector)

```bash
LOG_CONSOLE_FORMAT=json LOG_FILE_ENABLED=false yarn dev
```

### Debug a flaky session

```bash
LOG_LEVEL=debug yarn dev
```

## What is logged

### Agent path (`server/agent/index.ts` + `server/api/routes/agent.ts`)

- **Request received** — sessionId, chatSessionId, roleId, messageLen, whether the session is being resumed
- **Claude CLI spawn** — roleId, useDocker, hasMcp, resumed, sessionId
- **Claude CLI stderr** — streamed **line by line** as `error` records (so hung / failed CLI runs are visible in real time, not only on exit)
- **Claude CLI exit** — exit code
- **Request completed** — durationMs
- **Request failed** — captured error

### Other subsystems

Each uses its own prefix so filtering is easy:

- `[server]` — listen, unhandled error
- `[workspace]` — initial setup
- `[sandbox]` — Docker/container state, credential refresh
- `[mcp]` — MCP tool availability
- `[task-manager]` — task registration, ticks, failures
- `[journal]` — daily + optimization passes
- `[chat-index]` — session title/summary indexing
- `[pdf]`, `[generate-beat-audio]` — route-specific

## Extending

### Adding a log call

```ts
import { log } from "./logger/index.js";

log.info("my-module", "did a thing", { count: 3, name: "foo" });
log.error("my-module", "operation failed", { error: String(err) });
```

- `prefix` conventions: lowercase, hyphenated, no brackets — the text
  formatter adds `[ ]` itself.
- `data` payload keys should be scalar when possible so the text
  format renders cleanly; nested objects are JSON-serialized.
- Never call `console.*` directly outside `server/system/logger/`.

### Adding a new sink

Implement the `Sink` interface from `server/system/logger/types.ts`, then
wire it into `createLogger` in `server/system/logger/index.ts`. A sink's
`write` **must not throw** — errors should be caught and logged out
of band (see `createFileSink`'s `onError` callback for the pattern).

### Enabling telemetry (future)

The `TelemetrySink` is currently a no-op stub. When a transport is
added, it will be driven by the same `LOG_TELEMETRY_*` env vars listed
above — so downstream code that already calls `log.*` will
automatically feed it.
