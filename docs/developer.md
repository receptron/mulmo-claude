# Developer Guide

Reference for contributors hacking on MulmoClaude. End-user instructions live in [README.md](../README.md); architectural notes for the agent live in [CLAUDE.md](../CLAUDE.md). Read those first; this doc fills in the operational knobs and conventions.

---

## Contributing — please open an issue with a plan first

Thanks for wanting to contribute! Please read this section before sending a pull request — **we cannot accept large or AI-generated pull requests from outside contributors**, and unsolicited ones will be closed without a detailed review. The flow we ask for instead is:

1. **Open a GitHub issue describing the problem and a proposed plan.** A few paragraphs are enough: what's wrong (or what's missing), the approach you have in mind, the files you expect to touch, and any open questions. The files under [`plans/`](../plans/) are good references for the level of detail we want.
2. **Discuss the plan in the issue thread.** We may suggest scope adjustments, point out existing helpers or in-flight refactors that overlap, or surface constraints that are hard to see from the outside, such as security boundaries or deprecation paths. This is usually a short back-and-forth.
3. **A maintainer drafts the pull request.** Once we agree on the plan, one of us turns it into a pull request. You are welcome to follow the work, comment on the implementation, and flag anything that diverges from the agreed plan.

### How to write the issue

Maintainer review time is the bottleneck. These rules keep that time productive:

- **One issue covers exactly one topic.** If you have two unrelated proposals, file two issues. A combined issue is hard to scope, hard to review, and tends to stall on whichever half is harder.
- **Keep it short.** Long issues do not get read carefully. Aim for the smallest amount of text that fully covers the problem, the proposal, and any decision points the maintainer needs to weigh in on. If your draft does not fit on two screens, it is probably two issues.
- **Be specific.** Replace vague phrases with the concrete thing you mean. Instead of "the roles", write "the three built-in roles defined in `src/config/roles.ts`". Instead of "improve performance", write "reduce the number of `readFile` calls in `GET /api/sessions`".
- **Spell things out.** Avoid project-internal abbreviations and acronyms unless the same form already appears in the code or in [README.md](../README.md) / [CLAUDE.md](../CLAUDE.md). A reader who is new to MulmoClaude should be able to follow the issue without opening other documents.

### Why this flow — and why we close large unsolicited pull requests

AI coding assistants make it easy to generate large, polished-looking diffs in minutes. The catch is that reviewing such a pull request cold can take far longer than writing it, and even when the code reads cleanly, validating that no subtle behavioural, security, or data-handling regression slipped in is genuinely hard for a reviewer who did not help shape the design. We cannot responsibly merge code we cannot fully audit, and we cannot dedicate the review hours that auditing a large drive-by submission would require.

This is not about screening out AI-assisted work — the maintainer who drafts the pull request will often be using an agent too. The point is that **the plan is what we agree on, and the resulting code is owned by whoever lands it**. Locking that ownership boundary at the plan keeps responsibility clear and review focused on the parts that need human judgement.

### When you can skip the plan

A direct pull request is welcome for:

- Typos, copy fixes, documentation tweaks
- Dependency version bumps
- Single-file bug fixes with an obvious root cause and a matching test, ideally under 20 lines of diff
- Anything a maintainer or a continuous integration bot explicitly asks for in a review comment

Anything larger than that should start as an issue. If you are not sure, opening an issue first is always cheaper than writing a pull request that will not be accepted. Thanks for understanding.

---

## Environment variables

All env vars are **optional unless flagged "required"**. The server reads them at process start (or per-agent-invocation where noted); set them in `.env` (loaded via `dotenv`) or your shell.

### API keys

| Variable                    | Used by                       | Notes                                                                                                                                                    |
| --------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GEMINI_API_KEY`            | `server/utils/gemini.ts`      | Enables Gemini image generation / editing. Without it, image plugins surface a UI warning. The `geminiAvailable` flag in `GET /api/health` mirrors this. |
| `X_BEARER_TOKEN`            | `server/agent/mcp-tools/x.ts` | **Required** to enable `readXPost` / `searchX` MCP tools. Tools are silently disabled if absent.                                                         |
| `TELEGRAM_BOT_TOKEN`        | `@mulmobridge/telegram`       | **Required** for the Telegram bridge. BotFather token. Treat like a password. See [`message_apps/telegram/`](message_apps/telegram/).                    |
| `TELEGRAM_ALLOWED_CHAT_IDS` | `@mulmobridge/telegram`       | CSV of integer Telegram chat IDs allowed to message the bot. Empty / unset → deny everyone. A non-integer entry halts startup.                           |
| `TELEGRAM_POLL_TIMEOUT_SEC` | `@mulmobridge/telegram`       | Long-polling timeout in seconds. Defaults `25` (Telegram's recommended max).                                                                             |

### Runtime

| Variable                    | Default              | Effect                                                                                                                                                                                                                                                                                     |
| --------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PORT`                      | `3001`               | Express listen port (`server/index.ts:47`).                                                                                                                                                                                                                                                |
| `NODE_ENV`                  | unset / `production` | When `production`, Express serves the built client from `dist/client` and falls back to `index.html` for SPA history-mode routing. Auto-set by tooling — you rarely set this manually.                                                                                                     |
| `DISABLE_SANDBOX`           | unset                | Set to `1` to bypass the Docker sandbox even when Docker is available. The agent runs `claude` directly on the host. Useful for debugging without container rebuild overhead (`server/system/docker.ts:49`, `server/index.ts:147`).                                                        |
| `SANDBOX_SSH_AGENT_FORWARD` | unset                | Set to `1` to forward the host's `$SSH_AUTH_SOCK` into the sandbox. Private keys stay on the host; the agent signs on the container's behalf. Full contract: [docs/sandbox-credentials.md](sandbox-credentials.md).                                                                        |
| `SANDBOX_MOUNT_CONFIGS`     | unset                | CSV of allowlisted config mounts (currently `gh`, `gitconfig`). Each entry resolves to a fixed host→container path pair defined in `server/agent/sandboxMounts.ts`; unknown names are logged and ignored.                                                                                  |
| `SESSIONS_LIST_WINDOW_DAYS` | `90`                 | Caps how far back the sidebar looks when listing chat sessions (`server/api/routes/sessions.ts`). Set to `0` to disable the cutoff entirely. Introduced in PR #203 to keep `GET /api/sessions` cheap on long-lived workspaces; anything older is still on disk, just hidden from the list. |

### Debug startup hooks

Both gate idempotent backfills that normally run on a schedule. Set to `1` to force-run once at server start (`server/index.ts:197`, `:209`):

| Variable                          | Forces                                                            |
| --------------------------------- | ----------------------------------------------------------------- |
| `JOURNAL_FORCE_RUN_ON_STARTUP`    | A full daily journal pass over the workspace at boot.             |
| `CHAT_INDEX_FORCE_RUN_ON_STARTUP` | A backfill of session titles / summaries for every existing chat. |

### Logger (`LOG_*`)

The structured logger (`server/system/logger/`) reads its config fresh at process start. Full reference in [`docs/logging.md`](logging.md). Quick map:

| Variable                                   | Default              | Values                                                                                              |
| ------------------------------------------ | -------------------- | --------------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`                                | `info`               | Coarse knob — applies to both sinks unless overridden below. `error` \| `warn` \| `info` \| `debug` |
| `LOG_CONSOLE_LEVEL` / `LOG_FILE_LEVEL`     | `info` / `debug`     | Per-sink override.                                                                                  |
| `LOG_CONSOLE_FORMAT` / `LOG_FILE_FORMAT`   | `text` / `json`      | `text` (human) or `json` (JSONL).                                                                   |
| `LOG_CONSOLE_ENABLED` / `LOG_FILE_ENABLED` | `true` / `true`      | Boolean.                                                                                            |
| `LOG_FILE_DIR`                             | `server/system/logs` | Where rotating daily files land.                                                                    |
| `LOG_FILE_MAX_FILES`                       | `14`                 | Retention count.                                                                                    |
| `LOG_TELEMETRY_*`                          | —                    | Telemetry sink stub for a future remote shipper. No-op today.                                       |

### Container-only env (auto-set)

You never set these by hand; the server constructs them when spawning Claude inside the Docker sandbox (`server/agent/config.ts` and `server/agent/mcp-server.ts`). They're listed here so log lines / failures involving them are decodable.

| Variable                         | Set by         | Purpose                                                                                                                                      |
| -------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_ID`                     | per agent run  | Session id passed to the MCP stdio bridge.                                                                                                   |
| `PORT`                           | per agent run  | Host server port the bridge connects back to.                                                                                                |
| `PLUGIN_NAMES`                   | per agent run  | Comma-separated list of plugins active for this session's role.                                                                              |
| `ROLE_IDS`                       | per agent run  | Comma-separated list of all role ids.                                                                                                        |
| `MCP_HOST`                       | container only | `host.docker.internal` so the bridge inside the container can reach the host's Express server.                                               |
| `NODE_PATH`                      | container only | `/app/node_modules` — points the container's tsx runtime at the bind-mounted modules.                                                        |
| `HOME`                           | container only | `/home/node` so Claude CLI finds its credentials at `~/.claude`.                                                                             |
| Sentinel `X_BEARER_TOKEN=1` etc. | container only | `isMcpToolEnabled()` re-evaluates inside the container; the actual API call still happens on the host, so we only signal "enabled" with `1`. |

> **There is no `WORKSPACE_PATH` env var.** The workspace path is hard-coded to `~/mulmoclaude` in `server/workspace/workspace.ts:11`. To experiment with multiple workspaces you currently need a code change or a symlink swap.

---

## Scripts (`package.json`)

### Development

| Script                            | What it does                                                                                                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn dev`                        | Server (`:3001`) + Vite client (`:5173`) concurrently. The default.                                                                                                                                     |
| `yarn dev:debug`                  | Same as `dev` but spawns the server with `--debug` (Node inspector ready).                                                                                                                              |
| `yarn dev:client`                 | Vite client only — useful when you've already started the server elsewhere.                                                                                                                             |
| `yarn dev:server` / `yarn server` | Express server only.                                                                                                                                                                                    |
| `yarn server:debug`               | Server with `--debug` flag.                                                                                                                                                                             |
| `yarn cli`                        | CLI bridge — REPL in your terminal that talks to the running server (see [`bridge-protocol.md`](bridge-protocol.md)).                                                                                   |
| `yarn telegram`                   | Telegram bridge — operator guide at [`message_apps/telegram/`](message_apps/telegram/) (JP: [`README.ja.md`](message_apps/telegram/README.ja.md) / EN: [`README.md`](message_apps/telegram/README.md)). |

### Static checks

| Script                  | Notes                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------- |
| `yarn lint`             | ESLint on `src/` and `server/`. CI-blocking.                                       |
| `yarn format`           | Prettier auto-fix on `{src,server,test}/**/*.{ts,json,yaml,vue}`.                  |
| `yarn typecheck`        | `vue-tsc --noEmit` for the client.                                                 |
| `yarn typecheck:server` | `tsc -p server/tsconfig.json --noEmit` for the server (separate, stricter config). |
| `yarn build`            | Vite client build → `dist/client`, then server typecheck.                          |
| `yarn build:client`     | Client build only.                                                                 |

### Tests

| Script                                               | Notes                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn test`                                          | Node `node:test` unit suite. Globs across `test/*/test_*.ts` and 1–3 levels deep.                                                     |
| `yarn test:coverage`                                 | Same but with `--experimental-test-coverage`. CI uses this.                                                                           |
| `yarn test:e2e`                                      | Playwright (Chromium headless). Auto-starts Vite dev client.                                                                          |
| `yarn test:e2e -- tests/smoke.spec.ts`               | Single file.                                                                                                                          |
| `yarn test:e2e -- --headed`                          | Visible browser, useful for debugging.                                                                                                |
| `npx tsx --test test/agent/test_mcp_smoke.ts`        | MCP server subprocess smoke test (CI).                                                                                                |
| `npx tsx --test test/agent/test_mcp_docker_smoke.ts` | MCP server Docker smoke test (local only, requires `mulmoclaude-sandbox` image). Run after changing package exports or Docker mounts. |

### Docker sandbox

| Script                | Notes                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `yarn sandbox:remove` | `docker rmi mulmoclaude-sandbox` — force a rebuild on next run.                                                           |
| `yarn sandbox:login`  | macOS only. Exports the Claude CLI keychain entry to `~/.claude/.credentials.json` so the sandbox container can reuse it. |
| `yarn sandbox:logout` | Removes that file.                                                                                                        |

---

## Process map

Three independent Node processes cooperate at runtime:

1. **Express server** (`server/index.ts`) — listens on `localhost:3001`. Hosts every `/api/*` endpoint, the SSE stream for `POST /api/agent`, the pub-sub bus, and the cron-like [task manager](task-manager.md). Spawns the Claude CLI per agent invocation.
2. **Vite dev client** — listens on `localhost:5173`, proxies `/api/*` to `:3001`. Production builds skip Vite and let Express serve the static `dist/client`.
3. **MCP stdio bridge** (`server/agent/mcp-server.ts`) — spawned by the Claude CLI subprocess via `--mcp-config`. No HTTP listener: speaks JSON-RPC over stdin/stdout, forwards Claude's tool calls back to the Express server (`MCP_HOST:PORT/api/*`).

---

## Workspace layout (`~/mulmoclaude/`)

`initWorkspace()` creates / refreshes this on every server start (`server/workspace/workspace.ts`). Everything is plain files tracked in a private git repo, grouped into four top-level buckets by purpose (issue #284):

```text
~/mulmoclaude/
  config/             # app configuration
    settings.json     (web Settings UI — extraAllowedTools)
    mcp.json          (Claude CLI --mcp-config compatible)
    roles/            user-defined role overrides
    helps/            synced from server/workspace/helps/ at every boot
  conversations/      # chat + distilled context
    chat/             session ToolResults (one .jsonl per session)
    chat/index/       per-session title/summary cache
    memory.md         always-loaded agent context
    summaries/        journal output (daily/, topics/, archive/)
  data/               # user-managed content (the app treats these as authoritative)
    wiki/             personal knowledge wiki (index.md, pages/, sources/, log.md)
    todos/            todos.json + columns.json
    calendar/         calendar events
    contacts/         contact records
    scheduler/        scheduled tasks (items.json)
    sources/          information-source registry + state
    transports/       per-chat messaging bridge state (future)
  artifacts/          # LLM-generated output, mostly regenerable
    charts/
    documents/        (was markdowns/ pre-#284)
    html/             persistent saved HTML (was HTMLs/ pre-#284)
    html-scratch/     transient generate-and-preview buffer (was html/ pre-#284)
    images/           generated / edited images
    news/             daily news briefs
    spreadsheets/     .xlsx files
    stories/          mulmo scripts
  .session-token      bearer auth token (mode 0600, see Auth below)
  .git/               auto-init'd repo
  .mulmoclaude/       internal: per-session MCP config files
```

Existing workspaces from before #284 can optionally run the migration script to reorganize old directories:

```bash
yarn tsx scripts/migrate-workspace-284.ts --dry-run   # preview
yarn tsx scripts/migrate-workspace-284.ts --execute   # commit (backs up via rsync first)
```

> The server no longer blocks startup on pre-#284 layouts. The script is kept for users who want to clean up old directory names.

The `config/` dir is the home for the [web Settings UI](../README.md#configuring-additional-tools-web-settings) — `settings.json` carries `extraAllowedTools`, `mcp.json` follows Claude CLI's `--mcp-config` format so you can copy it between machines.

---

## Auth (bearer token on `/api/*`)

Every HTTP call to `/api/*` requires `Authorization: Bearer <token>`. Layered on top of the CSRF origin check (`server/api/csrfGuard.ts`): **both** must pass. The origin check stops cross-origin browser attacks; the bearer check stops sibling processes on the same machine that bypass browser CORS entirely.

**Exception — `/api/files/*`**: exempt from bearer auth because rendered markdown (`presentDocument`, wiki pages) embeds `<img src="/api/files/raw?path=...">` tags, and the browser's native image fetcher cannot attach an `Authorization` header. CSRF origin check + loopback-only binding still apply, so the exposure is limited to processes on localhost. The exemption is a negative-lookahead regex in `server/index.ts`.

**Token lifecycle**

| Event                            | What happens                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Server start                     | `generateAndWriteToken()` writes a fresh 32-byte hex token to `<workspace>/.session-token` (mode 0600)                                 |
| Vue page load / reload / new tab | Vite plugin (dev) / Express handler (prod) reads the file and substitutes `<meta name="mulmoclaude-auth" content="…">` into index.html |
| Vue bootstrap (`src/main.ts`)    | Reads the meta tag, calls `setAuthToken()` so every `apiFetch` attaches the header                                                     |
| HMR                              | No file I/O — token stays in Vue memory, SPA never reloads                                                                             |
| `SIGINT` / `SIGTERM`             | Best-effort `unlink` of `.session-token`                                                                                               |
| Crash / `kill -9`                | File may linger — harmless, next startup generates a new token and the stale value no longer matches                                   |

**Dev-mode escape hatch**: setting `MULMOCLAUDE_AUTH_TOKEN=…` before `yarn dev:client` makes the Vite plugin use that value instead of reading the file. Used by `e2e/playwright.config.ts` to inject a predictable token in E2E; also handy for debugging without a running server. Production (Express serving built HTML) never reads env — the in-memory token from `generateAndWriteToken()` is the sole source.

**Server-side pinning (#316)**: setting `MULMOCLAUDE_AUTH_TOKEN=…` before `yarn dev` (or any process that starts Express) makes `generateAndWriteToken()` use that value verbatim instead of generating a fresh random token. The same var is already honoured by the Vite dev plugin and the CLI bridge, so pinning it once in a shared shell / `.env` / docker-compose file keeps the token consistent across a server restart — long-running bridges no longer need a relaunch every time the dev server bounces. A warning logs if the override is shorter than 32 chars; no other validation. Use random-per-startup (the default) for casual dev and the env override only when the restart pain outweighs the leak surface (CI, docker, multi-bridge setups).

**Current scope** (#272 Phase 1+2): Vue client, Express middleware, and the CLI bridge (`yarn cli`). The bridge reads the same `.session-token` file (or `MULMOCLAUDE_AUTH_TOKEN` env var) on startup and attaches the header to its `fetch` calls.

**Files**

- `server/api/auth/token.ts` — generate / write / unlink
- `server/api/auth/bearerAuth.ts` — Express middleware
- `src/utils/api.ts` — `setAuthToken()` + header injection (no call site changes needed; `apiFetch` auto-attaches)
- `vite.config.ts` — `mulmoclaudeAuthTokenPlugin` for dev HTML substitution
- `@mulmobridge/client` (token.ts) — bridge-side resolver (env var → file)
- `@mulmobridge/client` (client.ts) — shared socket.io setup for every bridge (see `docs/bridge-protocol.md`)

---

## Notifications (PoC scaffold)

A one-shot, delayed **push fan-out** that lands on every open Web tab _and_ every connected bridge simultaneously. Scaffolding for the in-app notification center (#144) and external-channel notifications (#142) — the endpoint and fan-out are stable, the UI / persistence layers land in those issues.

### Trigger

```bash
curl -X POST http://localhost:3001/api/notifications/test \
  -H "Authorization: Bearer $(cat ~/mulmoclaude/.session-token)" \
  -H "Content-Type: application/json" \
  -d '{"message":"hello from curl","delaySeconds":5}'
# → 202 { "firesAt": "2026-04-16T15:37:42.123Z", "delaySeconds": 5 }
```

Body fields (all optional):

| Field          | Default                | Effect                                                                                                |
| -------------- | ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `message`      | `"Test notification"`  | Text delivered to both targets.                                                                       |
| `delaySeconds` | `60`, capped at `3600` | Timer length. Non-numeric / NaN falls back to the default; negative clamps to `0`; fractional floors. |
| `transportId`  | `"cli"`                | Bridge target for `chatService.pushToBridge`.                                                         |
| `chatId`       | `"notifications"`      | Bridge chat slot.                                                                                     |

### Fan-out at fire time

```text
setTimeout elapses
  ├─ pubsub.publish(PUBSUB_CHANNELS.notifications, { message, firedAt })  → Web
  └─ chatService.pushToBridge(transportId, chatId, message)               → Bridge (offline-queued)
```

Web subscribers listen on `PUBSUB_CHANNELS.notifications` (`src/config/pubsubChannels.ts`). The `useNotifications` composable wraps the subscription; `NotificationToast.vue` renders the latest inbound item as a top-right toast that auto-dismisses after 5 s. Bridges receive via the Phase B push socket (`yarn cli` prints `[push] notifications: hello …`).

### Observing the PoC end-to-end

1. `yarn dev` (server + Vite)
2. In a second terminal: `yarn cli`
3. In a third terminal: fire the curl above with `delaySeconds: 5`
4. After 5 s: a toast slides in top-right of the open browser tab ("hello from curl"), and the CLI terminal prints `[push] notifications: hello from curl`

### Scope caveats

- **Single toast**, no stack / notification-center bell / bell badge — those land with the real notification center (#144). The toast is intentionally a thin wrapper to confirm the pipeline delivers.
- **No persistence**: `setTimeout` is in-memory; a server restart before the delay elapses drops the push.
- **One bridge per call**: `pushToBridge` targets a single `transportId`. Fan-out to every connected bridge is deferred until a caller needs it.
- **One-shot only**: no repeat / snooze / dedup. Production triggers should go through the notification center once #144 lands.

Full motivation + file plan: `plans/feat-notification-push-scaffold.md`. Implementation: `server/events/notifications.ts` (scheduler) + `server/api/routes/notifications.ts` (HTTP wrapper) + `src/composables/useNotifications.ts` + `src/components/NotificationToast.vue`.

---

## Centralized constants (`as const` modules)

Cross-module string literals (endpoint paths, tool names, role IDs, etc.) are defined once and imported everywhere. A typo in an import key fails typecheck; a typo in a raw string literal silently produces a runtime 404 or broken channel.

| Constant                               | Module                         | Consumers                                                                                                                                            |
| -------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_ROUTES`                           | `src/config/apiRoutes.ts`      | Server route files (`router.post(API_ROUTES.todos.items, ...)`), frontend fetch calls (`fetch(API_ROUTES.todos.items)`), MCP bridge `postJson` calls |
| `EVENT_TYPES` / `EventType`            | `src/types/events.ts`          | SSE stream emitters, pub-sub session events, chat jsonl parsers, `AgentEvent` union discriminators                                                   |
| `WORKSPACE_PATHS` / `WORKSPACE_DIRS`   | `server/workspace/paths.ts`    | Every server module that reads or writes workspace files                                                                                             |
| `TOOL_NAMES` / `ToolName`              | `src/config/toolNames.ts`      | Role definitions (`availablePlugins`), plugin registry, session-store tool matching                                                                  |
| `BUILTIN_ROLE_IDS` / `BuiltInRoleId`   | `src/config/roles.ts`          | Anywhere a built-in role ID appears outside the role definition itself                                                                               |
| `PUBSUB_CHANNELS` / `sessionChannel()` | `src/config/pubsubChannels.ts` | Pub-sub publish/subscribe sites in session-store and task-manager                                                                                    |
| `EVENT_TYPES` / `EventType`            | `src/types/events.ts`          | SSE event type discriminants in agent loop, session store, and frontend dispatch                                                                     |

**Convention**: add new entries to the appropriate module before writing the first consumer. Keep the `as const` assertion so TypeScript infers literal types, not `string`.

---

## Docker sandbox (`Dockerfile.sandbox`)

Minimal image: `node:22-slim` + `@anthropic-ai/claude-code` + `tsx`. Built lazily on first Docker-mode run; rebuilt when `Dockerfile.sandbox` changes (image SHA pinned in code). `yarn sandbox:remove` forces a rebuild.

**Bind mounts** (constructed by `buildDockerSpawnArgs` in `server/agent/config.ts`):

| Host             | Container                 | Mode             |
| ---------------- | ------------------------- | ---------------- |
| `./node_modules` | `/app/node_modules`       | ro               |
| `./packages`     | `/app/packages`           | ro               |
| `./server`       | `/app/server`             | ro               |
| `./src`          | `/app/src`                | ro               |
| `<workspace>`    | `/home/node/mulmoclaude`  | rw               |
| `~/.claude`      | `/home/node/.claude`      | rw (credentials) |
| `~/.claude.json` | `/home/node/.claude.json` | ro               |

**Path translation**: `resolveMcpConfigPaths()` writes the per-session MCP config to `<workspace>/.mulmoclaude/mcp-<id>.json` on the host and passes the container path to `--mcp-config`.

**Limitations** ([#162](https://github.com/receptron/mulmoclaude/issues/162) tracks): no `python`, `git`, `jq`, or arbitrary binaries inside the container. User-defined stdio MCP servers added via the Settings UI are limited to `npx` / `node` / `tsx` for that reason; HTTP MCP servers work universally.

---

## Chat attachments (paste / drag-and-drop)

Users can paste or drop files into the chat input. The server converts non-native types before forwarding to Claude.

| Type                                                 | Conversion           | Claude block       | Dependency      | Environment                      |
| ---------------------------------------------------- | -------------------- | ------------------ | --------------- | -------------------------------- |
| image/\*                                             | None (native)        | `type: "image"`    | —               | All                              |
| PDF                                                  | None (native)        | `type: "document"` | —               | All                              |
| text/\* (.txt, .csv, .json, .md, .xml, .html, .yaml) | base64 → UTF-8       | `type: "text"`     | —               | All                              |
| DOCX                                                 | mammoth → plain text | `type: "text"`     | `mammoth` (npm) | All                              |
| XLSX                                                 | xlsx → CSV per sheet | `type: "text"`     | `xlsx` (npm)    | All                              |
| PPTX                                                 | libreoffice → PDF    | `type: "document"` | LibreOffice     | Docker sandbox or native install |

**PPTX conversion path**: the server process runs on the host (macOS/Linux), but LibreOffice lives inside the Docker sandbox image. `convertPptxToPdf()` in `server/agent/attachmentConverter.ts` tries native `libreoffice` first; if not found, falls back to `docker run --rm -v tmpdir:/data mulmoclaude-sandbox libreoffice --headless --convert-to pdf`. Without either, the user sees a text hint suggesting PDF or image export.

**Adding a new type**: add MIME handling in `server/agent/attachmentConverter.ts` (conversion logic), update `isConvertibleMime()` + `CONVERTIBLE_MIME_TYPES`, and add the MIME to `ACCEPTED_MIME_EXACT` in `src/App.vue`.

---

## Logging conventions

Full reference: [`docs/logging.md`](logging.md). Two rules to keep in mind when contributing:

1. **Never call `console.*` outside `server/system/logger/`.** Import and use `log.{error,warn,info,debug}(prefix, msg, data?)` instead. The structured payload powers JSON file shipping and grep-friendly text output. The only sanctioned `console.error` is the file-sink fallback inside the logger itself.
2. **Prefix is lowercase, hyphenated, no brackets.** The text formatter wraps it in `[ ]`. Keep payload values scalar; nested objects are JSON-stringified.

Existing prefixes in use: `agent`, `agent-stderr`, `server`, `workspace`, `sandbox`, `mcp`, `task-manager`, `journal`, `chat-index`, `pdf`, `config`.

---

## Test layout

`test/` mirrors `server/` and `src/` 1:1; e.g. `server/workspace/journal/dailyPass.ts` → `test/journal/test_dailyPass.ts`. The pattern: extract pure helpers from route handlers / Vue composables, then unit-test them without an HTTP harness. The test glob in `package.json` walks 1–3 directory levels — keep new tests at the right depth or extend the glob.

E2E tests live in `e2e/tests/*.spec.ts`. **No backend runs**; `await mockAllApis(page)` from `e2e/fixtures/api.ts` intercepts every `/api/*` call. Per-test mocks registered AFTER `mockAllApis` win because Playwright walks routes last-registered-first.

When to add E2E coverage is documented in [CLAUDE.md](../CLAUDE.md#when-to-add-e2e-coverage).

---

## CI (`.github/workflows/pull_request.yaml`)

Two jobs gate every PR:

- **`lint_test`** — matrix: Node 22.x & 24.x × {ubuntu, windows, macOS}. Runs `typecheck`, `typecheck:server`, `lint`, `build`, `test:coverage`.
- **`e2e`** — Ubuntu / Node 22.x. Runs `playwright install chromium` then `test:e2e`. Failed runs upload `test-results/` as an artifact for 7 days.

Cross-platform compatibility is a hard requirement — use `node:path` joins, `node:url` for file URL conversions, no shell-specific syntax in scripts.

---

## Internal packages (`packages/`)

MulmoClaude uses a yarn-workspaces monorepo. Shared code lives in `packages/`, published to npm as independent MIT-licensed packages.

| Package                     | Scope     | Description                                      |
| --------------------------- | --------- | ------------------------------------------------ |
| `@mulmobridge/protocol`     | messaging | Wire protocol types and constants                |
| `@mulmobridge/chat-service` | messaging | Server-side Express + socket.io chat service     |
| `@mulmobridge/client`       | messaging | Bridge-side socket.io client library             |
| `@mulmobridge/mock-server`  | messaging | Lightweight mock server for testing              |
| `@mulmobridge/cli`          | messaging | Interactive terminal bridge                      |
| `@mulmobridge/telegram`     | messaging | Telegram bot bridge                              |
| `@mulmobridge/slack`        | messaging | Slack bot bridge (Socket Mode)                   |
| `@mulmobridge/discord`      | messaging | Discord bot bridge                               |
| `@mulmobridge/line`         | messaging | LINE bot bridge (webhook)                        |
| `@mulmobridge/whatsapp`     | messaging | WhatsApp Cloud API bridge (webhook)              |
| `@mulmobridge/matrix`       | messaging | Matrix bridge (matrix-js-sdk)                    |
| `@mulmobridge/irc`          | messaging | IRC bridge (irc-framework)                       |
| `@mulmobridge/mattermost`   | messaging | Mattermost bridge (WebSocket + REST)             |
| `@mulmobridge/zulip`        | messaging | Zulip bridge (long-polling events API)           |
| `@mulmobridge/messenger`    | messaging | Facebook Messenger bridge (webhook + HMAC)       |
| `@mulmobridge/google-chat`  | messaging | Google Chat bridge (webhook + JWT)               |
| `@receptron/task-scheduler` | general   | Persistent task scheduler with catch-up recovery |

**Build order matters** — `build:packages` in root `package.json` runs them in dependency order. When adding a new package, insert it at the correct position in the chain.

**Source-first dev** — in the workspace, `tsx` resolves symlinks to `.ts` source directly, so `dist/` builds are only needed for npm publish and CI typecheck.

See [`packages/README.md`](../packages/README.md) for the MulmoBridge architecture overview.

---

## Common gotchas

- **Vite `reuseExistingServer: true`** in `e2e/playwright.config.ts` — if a stale `vite` process is already serving `:5173` (e.g. from a different working tree), Playwright happily talks to _that_ one. Symptom: tests fail because UI changes "haven't landed". Kill the stray process: `lsof -i :5173 | grep LISTEN`.
- **CSRF guard is strict.** `requireSameOrigin` (`server/api/csrfGuard.ts`) rejects state-changing requests from non-localhost origins. Requests with no `Origin` header (CLI tools, server-to-server) are allowed because the listener is bound to `127.0.0.1`. If you ever expose the listener publicly, tighten this middleware first.
- **Workspace is git-init'd.** The first server start creates `~/mulmoclaude/.git`. Don't be surprised when journal / wiki edits show up in `git log`.
- **`.vue` cognitive-complexity is warn-only.** A few legacy components exceed 15. The override demotes the rule to warn so CI isn't blocked. Each fix should re-raise to error in `eslint.config.mjs`.
- **MCP plugin registration touches 4–7 places.** See the "Plugin Development" section in [CLAUDE.md](../CLAUDE.md). Forgetting one location silently drops the plugin (no error, just missing tool).
- **Settings reload is per-agent-call, not per-process.** `loadSettings()` runs every time `runAgent` spawns Claude, so the Settings UI takes effect on the next message — but a long-running script that holds an agent reference won't pick up changes mid-stream.

---

## Where to file what

| Problem area                  | File / dir                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| Adding a new `/api/*` route   | `server/api/routes/<name>.ts`, wire in `server/index.ts`                    |
| Adding a shared server helper | `server/utils/<concept>.ts` (one concept per file)                          |
| Adding a Vue composable       | `src/composables/use<Name>.ts`                                              |
| Adding a plugin               | `src/plugins/<name>/{definition,index,View,Preview}.ts/vue` — see CLAUDE.md |
| Adding a test                 | `test/<mirrored-source-path>/test_<module>.ts`                              |
| New developer-facing doc      | `docs/<name>.md` and link from the table at the top of the README           |
