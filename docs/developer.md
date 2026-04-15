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

| Variable | Used by | Notes |
|---|---|---|
| `GEMINI_API_KEY` | `server/utils/gemini.ts` | Enables Gemini image generation / editing. Without it, image plugins surface a UI warning. The `geminiAvailable` flag in `GET /api/health` mirrors this. |
| `X_BEARER_TOKEN` | `server/mcp-tools/x.ts` | **Required** to enable `readXPost` / `searchX` MCP tools. Tools are silently disabled if absent. |

### Runtime

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3001` | Express listen port (`server/index.ts:47`). |
| `NODE_ENV` | unset / `production` | When `production`, Express serves the built client from `dist/client` and falls back to `index.html` for SPA history-mode routing. Auto-set by tooling — you rarely set this manually. |
| `DISABLE_SANDBOX` | unset | Set to `1` to bypass the Docker sandbox even when Docker is available. The agent runs `claude` directly on the host. Useful for debugging without container rebuild overhead (`server/docker.ts:49`, `server/index.ts:147`). |
| `SESSIONS_LIST_WINDOW_DAYS` | `90` | Caps how far back the sidebar looks when listing chat sessions (`server/routes/sessions.ts`). Set to `0` to disable the cutoff entirely. Introduced in PR #203 to keep `GET /api/sessions` cheap on long-lived workspaces; anything older is still on disk, just hidden from the list. |

### Debug startup hooks

Both gate idempotent backfills that normally run on a schedule. Set to `1` to force-run once at server start (`server/index.ts:197`, `:209`):

| Variable | Forces |
|---|---|
| `JOURNAL_FORCE_RUN_ON_STARTUP` | A full daily journal pass over the workspace at boot. |
| `CHAT_INDEX_FORCE_RUN_ON_STARTUP` | A backfill of session titles / summaries for every existing chat. |

### Logger (`LOG_*`)

The structured logger (`server/logger/`) reads its config fresh at process start. Full reference in [`docs/logging.md`](logging.md). Quick map:

| Variable | Default | Values |
|---|---|---|
| `LOG_LEVEL` | `info` | Coarse knob — applies to both sinks unless overridden below. `error` \| `warn` \| `info` \| `debug` |
| `LOG_CONSOLE_LEVEL` / `LOG_FILE_LEVEL` | `info` / `debug` | Per-sink override. |
| `LOG_CONSOLE_FORMAT` / `LOG_FILE_FORMAT` | `text` / `json` | `text` (human) or `json` (JSONL). |
| `LOG_CONSOLE_ENABLED` / `LOG_FILE_ENABLED` | `true` / `true` | Boolean. |
| `LOG_FILE_DIR` | `server/logs` | Where rotating daily files land. |
| `LOG_FILE_MAX_FILES` | `14` | Retention count. |
| `LOG_TELEMETRY_*` | — | Telemetry sink stub for a future remote shipper. No-op today. |

### Container-only env (auto-set)

You never set these by hand; the server constructs them when spawning Claude inside the Docker sandbox (`server/agent/config.ts` and `server/mcp-server.ts`). They're listed here so log lines / failures involving them are decodable.

| Variable | Set by | Purpose |
|---|---|---|
| `SESSION_ID` | per agent run | Session id passed to the MCP stdio bridge. |
| `PORT` | per agent run | Host server port the bridge connects back to. |
| `PLUGIN_NAMES` | per agent run | Comma-separated list of plugins active for this session's role. |
| `ROLE_IDS` | per agent run | Comma-separated list of all role ids. |
| `MCP_HOST` | container only | `host.docker.internal` so the bridge inside the container can reach the host's Express server. |
| `NODE_PATH` | container only | `/app/node_modules` — points the container's tsx runtime at the bind-mounted modules. |
| `HOME` | container only | `/home/node` so Claude CLI finds its credentials at `~/.claude`. |
| Sentinel `X_BEARER_TOKEN=1` etc. | container only | `isMcpToolEnabled()` re-evaluates inside the container; the actual API call still happens on the host, so we only signal "enabled" with `1`. |

> **There is no `WORKSPACE_PATH` env var.** The workspace path is hard-coded to `~/mulmoclaude` in `server/workspace.ts:11`. To experiment with multiple workspaces you currently need a code change or a symlink swap.

---

## Scripts (`package.json`)

### Development

| Script | What it does |
|---|---|
| `yarn dev` | Server (`:3001`) + Vite client (`:5173`) concurrently. The default. |
| `yarn dev:debug` | Same as `dev` but spawns the server with `--debug` (Node inspector ready). |
| `yarn dev:client` | Vite client only — useful when you've already started the server elsewhere. |
| `yarn dev:server` / `yarn server` | Express server only. |
| `yarn server:debug` | Server with `--debug` flag. |

### Static checks

| Script | Notes |
|---|---|
| `yarn lint` | ESLint on `src/` and `server/`. CI-blocking. |
| `yarn format` | Prettier auto-fix on `{src,server,test}/**/*.{ts,json,yaml,vue}`. |
| `yarn typecheck` | `vue-tsc --noEmit` for the client. |
| `yarn typecheck:server` | `tsc -p server/tsconfig.json --noEmit` for the server (separate, stricter config). |
| `yarn build` | Vite client build → `dist/client`, then server typecheck. |
| `yarn build:client` | Client build only. |

### Tests

| Script | Notes |
|---|---|
| `yarn test` | Node `node:test` unit suite. Globs across `test/*/test_*.ts` and 1–3 levels deep. |
| `yarn test:coverage` | Same but with `--experimental-test-coverage`. CI uses this. |
| `yarn test:e2e` | Playwright (Chromium headless). Auto-starts Vite dev client. |
| `yarn test:e2e -- tests/smoke.spec.ts` | Single file. |
| `yarn test:e2e -- --headed` | Visible browser, useful for debugging. |

### Docker sandbox

| Script | Notes |
|---|---|
| `yarn sandbox:remove` | `docker rmi mulmoclaude-sandbox` — force a rebuild on next run. |
| `yarn sandbox:login` | macOS only. Exports the Claude CLI keychain entry to `~/.claude/.credentials.json` so the sandbox container can reuse it. |
| `yarn sandbox:logout` | Removes that file. |

---

## Process map

Three independent Node processes cooperate at runtime:

1. **Express server** (`server/index.ts`) — listens on `localhost:3001`. Hosts every `/api/*` endpoint, the SSE stream for `POST /api/agent`, the pub-sub bus, and the cron-like [task manager](task-manager.md). Spawns the Claude CLI per agent invocation.
2. **Vite dev client** — listens on `localhost:5173`, proxies `/api/*` to `:3001`. Production builds skip Vite and let Express serve the static `dist/client`.
3. **MCP stdio bridge** (`server/mcp-server.ts`) — spawned by the Claude CLI subprocess via `--mcp-config`. No HTTP listener: speaks JSON-RPC over stdin/stdout, forwards Claude's tool calls back to the Express server (`MCP_HOST:PORT/api/*`).

---

## Workspace layout (`~/mulmoclaude/`)

`initWorkspace()` creates / refreshes this on every server start (`server/workspace.ts`). Everything is plain files tracked in a private git repo:

```text
~/mulmoclaude/
  chat/               session ToolResults (.jsonl per session)
  chat/index/         per-session title/summary cache
  todos/              todos.json + columns.json
  calendar/           calendar events
  contacts/           contact records
  scheduler/          scheduled tasks
  roles/              user-defined role overrides
  stories/            mulmo scripts
  images/             generated / edited images
  markdowns/          markdown documents
  spreadsheets/       .xlsx files
  configs/            settings.json, mcp.json (web Settings UI)
  helps/              synced from server/helps/ at every boot
  memory.md           always-loaded agent context
  .git/               auto-init'd repo
  .mulmoclaude/       internal: per-session MCP config files
```

The `configs/` dir is the home for the [web Settings UI](../README.md#configuring-additional-tools-web-settings) — `settings.json` carries `extraAllowedTools`, `mcp.json` follows Claude CLI's `--mcp-config` format so you can copy it between machines.

---

## Docker sandbox (`Dockerfile.sandbox`)

Minimal image: `node:22-slim` + `@anthropic-ai/claude-code` + `tsx`. Built lazily on first Docker-mode run; rebuilt when `Dockerfile.sandbox` changes (image SHA pinned in code). `yarn sandbox:remove` forces a rebuild.

**Bind mounts** (constructed by `buildDockerSpawnArgs` in `server/agent/config.ts`):

| Host | Container | Mode |
|---|---|---|
| `./node_modules` | `/app/node_modules` | ro |
| `./server` | `/app/server` | ro |
| `./src` | `/app/src` | ro |
| `<workspace>` | `/home/node/mulmoclaude` | rw |
| `~/.claude` | `/home/node/.claude` | rw (credentials) |
| `~/.claude.json` | `/home/node/.claude.json` | ro |

**Path translation**: `resolveMcpConfigPaths()` writes the per-session MCP config to `<workspace>/.mulmoclaude/mcp-<id>.json` on the host and passes the container path to `--mcp-config`.

**Limitations** ([#162](https://github.com/receptron/mulmoclaude/issues/162) tracks): no `python`, `git`, `jq`, or arbitrary binaries inside the container. User-defined stdio MCP servers added via the Settings UI are limited to `npx` / `node` / `tsx` for that reason; HTTP MCP servers work universally.

---

## Logging conventions

Full reference: [`docs/logging.md`](logging.md). Two rules to keep in mind when contributing:

1. **Never call `console.*` outside `server/logger/`.** Import and use `log.{error,warn,info,debug}(prefix, msg, data?)` instead. The structured payload powers JSON file shipping and grep-friendly text output. The only sanctioned `console.error` is the file-sink fallback inside the logger itself.
2. **Prefix is lowercase, hyphenated, no brackets.** The text formatter wraps it in `[ ]`. Keep payload values scalar; nested objects are JSON-stringified.

Existing prefixes in use: `agent`, `agent-stderr`, `server`, `workspace`, `sandbox`, `mcp`, `task-manager`, `journal`, `chat-index`, `pdf`, `config`.

---

## Test layout

`test/` mirrors `server/` and `src/` 1:1; e.g. `server/journal/dailyPass.ts` → `test/journal/test_dailyPass.ts`. The pattern: extract pure helpers from route handlers / Vue composables, then unit-test them without an HTTP harness. The test glob in `package.json` walks 1–3 directory levels — keep new tests at the right depth or extend the glob.

E2E tests live in `e2e/tests/*.spec.ts`. **No backend runs**; `await mockAllApis(page)` from `e2e/fixtures/api.ts` intercepts every `/api/*` call. Per-test mocks registered AFTER `mockAllApis` win because Playwright walks routes last-registered-first.

When to add E2E coverage is documented in [CLAUDE.md](../CLAUDE.md#when-to-add-e2e-coverage).

---

## CI (`.github/workflows/pull_request.yaml`)

Two jobs gate every PR:

- **`lint_test`** — matrix: Node 22.x & 24.x × {ubuntu, windows, macOS}. Runs `typecheck`, `typecheck:server`, `lint`, `build`, `test:coverage`.
- **`e2e`** — Ubuntu / Node 22.x. Runs `playwright install chromium` then `test:e2e`. Failed runs upload `test-results/` as an artifact for 7 days.

Cross-platform compatibility is a hard requirement — use `node:path` joins, `node:url` for file URL conversions, no shell-specific syntax in scripts.

---

## Common gotchas

- **Vite `reuseExistingServer: true`** in `e2e/playwright.config.ts` — if a stale `vite` process is already serving `:5173` (e.g. from a different working tree), Playwright happily talks to *that* one. Symptom: tests fail because UI changes "haven't landed". Kill the stray process: `lsof -i :5173 | grep LISTEN`.
- **CSRF guard is strict.** `requireSameOrigin` (`server/csrfGuard.ts`) rejects state-changing requests from non-localhost origins. Requests with no `Origin` header (CLI tools, server-to-server) are allowed because the listener is bound to `127.0.0.1`. If you ever expose the listener publicly, tighten this middleware first.
- **Workspace is git-init'd.** The first server start creates `~/mulmoclaude/.git`. Don't be surprised when journal / wiki edits show up in `git log`.
- **`.vue` cognitive-complexity is warn-only.** A few legacy components exceed 15. The override demotes the rule to warn so CI isn't blocked. Each fix should re-raise to error in `eslint.config.mjs`.
- **MCP plugin registration touches 4–7 places.** See the "Plugin Development" section in [CLAUDE.md](../CLAUDE.md). Forgetting one location silently drops the plugin (no error, just missing tool).
- **Settings reload is per-agent-call, not per-process.** `loadSettings()` runs every time `runAgent` spawns Claude, so the Settings UI takes effect on the next message — but a long-running script that holds an agent reference won't pick up changes mid-stream.

---

## Where to file what

| Problem area | File / dir |
|---|---|
| Adding a new `/api/*` route | `server/routes/<name>.ts`, wire in `server/index.ts` |
| Adding a shared server helper | `server/utils/<concept>.ts` (one concept per file) |
| Adding a Vue composable | `src/composables/use<Name>.ts` |
| Adding a plugin | `src/plugins/<name>/{definition,index,View,Preview}.ts/vue` — see CLAUDE.md |
| Adding a test | `test/<mirrored-source-path>/test_<module>.ts` |
| New developer-facing doc | `docs/<name>.md` and link from the table at the top of the README |
