# feat: server-side structured logger (#91)

## Motivation

Server's agent path is currently silent in the console — when the spawned `claude` CLI fails (e.g. `--resume` against a stale session), nothing is printed. Existing `[sandbox]` / `[mcp]` prefixed logs are ad-hoc `console.log` calls. We want a small, typed, dependency-free logger with:

- Console + file output out of the box (debuggability-first)
- Per-sink level + per-sink format (text vs JSON)
- Daily file rotation with retention
- A telemetry sink interface reserved for the future

## Design

### Module layout

```
server/system/logger/
  index.ts         — public API: log.{error,warn,info,debug}(prefix, msg, data?)
  types.ts         — LogLevel, LogRecord, Sink, Formatter
  config.ts        — typed config, defaults, env-var overrides
  formatters.ts    — text + json formatters (pure)
  sinks.ts         — console sink, file sink, telemetry stub
  rotation.ts      — daily rotation + maxFiles retention
```

Tests mirror layout under `test/logger/`.

### Public API

```ts
export const log = {
  error(prefix: string, msg: string, data?: Record<string, unknown>): void;
  warn (prefix: string, msg: string, data?: Record<string, unknown>): void;
  info (prefix: string, msg: string, data?: Record<string, unknown>): void;
  debug(prefix: string, msg: string, data?: Record<string, unknown>): void;
};
```

`prefix` is the existing `[sandbox]` / `[mcp]` / `[agent]` convention. `data` is an optional object serialized into the structured form.

### Record shape

```ts
interface LogRecord {
  ts: string;             // ISO timestamp
  level: LogLevel;        // "error" | "warn" | "info" | "debug"
  prefix: string;         // "agent", "sandbox", "mcp", "chatIndex"…
  message: string;
  data?: Record<string, unknown>;
}
```

Each `log.*` call builds one record and fans it out to every enabled sink whose `level` threshold admits it.

### Config

`LoggerConfig` type defined in `config.ts`. Defaults:

```ts
{
  sinks: {
    console:   { level: "info",  format: "text", enabled: true },
    file:      { level: "debug", format: "json", dir: "server/system/logs",
                 rotation: { kind: "daily", maxFiles: 14 }, enabled: true },
    telemetry: { level: "error", format: "json", enabled: false },
  },
}
```

Env overrides (all optional):

| Var | Target |
|---|---|
| `LOG_LEVEL` | overrides **both** console+file level (coarse knob, matches original issue) |
| `LOG_CONSOLE_LEVEL` | per-sink override |
| `LOG_FILE_LEVEL` | per-sink override |
| `LOG_CONSOLE_FORMAT` | `text` / `json` |
| `LOG_FILE_FORMAT` | `text` / `json` |
| `LOG_CONSOLE_ENABLED` | `true` / `false` |
| `LOG_FILE_ENABLED` | `true` / `false` |
| `LOG_FILE_DIR` | directory for rotated files |
| `LOG_FILE_MAX_FILES` | retention count |

Config resolved **once** at module load (pure function on `process.env`). Exported `resolveConfig(env)` function for tests.

### Formatters

- `formatText(record)` → `2026-04-13T07:12:45.123Z INFO  [agent] request received sessionId=abc role=default`
- `formatJson(record)` → `{"ts":"2026-04-13T…","level":"info","prefix":"agent","message":"request received","data":{"sessionId":"abc","roleId":"default"}}`

Formatters are **pure** — they take a record, return a string. Easy to unit test.

### Sinks

Each sink implements:

```ts
interface Sink {
  level: LogLevel;
  write(record: LogRecord): void; // fire-and-forget; MUST NOT throw
}
```

- **ConsoleSink** — `process.stderr.write` for warn/error, `process.stdout.write` for info/debug (so redirecting stderr captures only problems).
- **FileSink** — owns a rotating file handle; appends newline-terminated formatted strings. On first use creates dir (`mkdir -p`). Errors are caught and rerouted to `process.stderr` with a one-liner (never throw back into caller).
- **TelemetrySink** — stub that exposes the interface and a `configure(endpoint)` no-op. Disabled by default.

### Rotation

Daily: file name = `server-YYYY-MM-DD.log`. Check date on every write; if the date has rolled over, swap the handle to the new filename, then enforce `maxFiles` by listing the dir, sorting by name desc, deleting anything beyond `maxFiles`. Rotation is atomic per-write (no background timer).

Kept dependency-free by using `fs.promises.appendFile` (fire-and-forget). Concurrency: writes are queued through a simple per-sink promise chain so interleaved rotations don't race.

### Wiring

1. `server/api/routes/agent.ts` — log on: request received (sessionId, roleId, messageLen), streaming start, completion (duration ms, eventCount), error. Prefix `agent`.
2. `server/agent/index.ts` — already streams `proc.stderr` via a buffer; additionally `log.error("agent-stderr", line)` per line. Log process exit code on close. Log session start (abs path, role, cwd). Prefix `agent`.
3. Migrate existing console lines:
   - `[sandbox]` / `[mcp]` / `[chatIndex]` / `[docker]` / `[csrf]` → `log.info(prefix, ...)` (or `.warn` / `.error` depending on semantics).
4. `eslint-disable-next-line no-console` allowed **only** inside `server/system/logger/sinks.ts` (fallback error path). Rest of server disallowed via eslint override.

### Tests (node:test)

- `test/logger/test_formatters.ts` — happy + unicode + empty data + level casing
- `test/logger/test_config.ts` — defaults, each env var override, invalid values fall back
- `test/logger/test_sinks_file.ts` — writes to tmp dir, creates dir, rotates on date rollover (fake clock), enforces maxFiles
- `test/logger/test_log.ts` — fan-out: record hits only sinks whose level admits it; disabled sinks get no write

All tests use tmp dirs via `fs.mkdtempSync(os.tmpdir() + "/log-")` and clean up in `after`.

### Acceptance (matches issue + scope expansion)

- [x] server agent path emits ≥1 info line per `/api/agent` request + completion
- [x] claude CLI stderr forwarded as it arrives
- [x] `LOG_CONSOLE_ENABLED=false LOG_FILE_ENABLED=true` writes only to file
- [x] `LOG_LEVEL=debug` enables verbose lines
- [x] existing `[sandbox]` / `[mcp]` lines still appear (via new logger)
- [x] no external deps added
- [x] daily rotation + maxFiles retention
- [x] per-sink format (text vs json)
- [x] telemetry sink interface exists, disabled by default
- [x] `server/system/logs/` is git-ignored

## Out of scope

- Size-based rotation (daily + retention is enough for now)
- Log shipping / actual telemetry implementation (stub only)
- Per-route overrides

## Rollout steps

1. Branch `feat/server-logger` from `main` ✅
2. Write this plan ✅
3. Implement `server/system/logger/` + tests
4. Wire into agent paths
5. Migrate existing console calls
6. `yarn format && yarn lint && yarn typecheck && yarn build && yarn test && yarn test:e2e`
7. Commit by concern; open PR to `main`
