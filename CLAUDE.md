# CLAUDE.md

This file provides guidance to Claude Code when working with the MulmoClaude repository.

## Project Overview

MulmoClaude is a text/task-driven agent app with rich visual output. It uses **Claude Code Agent SDK** as the LLM core and **gui-chat-protocol** as the plugin layer. Shared code is published as `@mulmobridge/*` npm packages under `packages/`.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

See `plan/mulmo_claude.md` for the full design plan.

## Key Commands

- **Dev server**: `npm run dev` (runs both client and server concurrently)
- **Lint**: `yarn lint` / **Format**: `yarn format` / **Typecheck**: `yarn typecheck` / **Build**: `yarn build`
- **Unit tests**: `yarn test` (node:test, server handlers + utils)
- **E2E tests**: `yarn test:e2e` (Playwright, browser UI tests — no backend needed)
- **E2E single file**: `yarn test:e2e -- tests/smoke.spec.ts`
- **E2E headed**: `yarn test:e2e -- --headed` (opens browser for debugging)

**IMPORTANT**: After modifying any source code, always run `yarn format`, `yarn lint`, `yarn typecheck`, and `yarn build` before considering the task done.

**IMPORTANT**: Always write error handling for all `fetch` calls. Handle both network errors (try/catch) and HTTP errors (`!response.ok`). Surface errors to the user in the UI where appropriate.

## Releases

When creating a release (tagging a version, `gh release create`, npm publish):

1. MUST update [`docs/CHANGELOG.md`](docs/CHANGELOG.md) with the new version entry **before** or **in the same commit as** the tag
2. Follow the [Keep a Changelog](https://keepachangelog.com/) format: `## [x.y.z] - YYYY-MM-DD` with sections `Added`, `Changed`, `Fixed`, `Breaking Changes`
3. Add the release URL to the link reference list at the bottom of the file
4. For npm package releases, list package names and versions in the entry
5. MUST run `date` to get today's date — NEVER guess

## GitHub posts (gh pr comment / gh issue comment / PR body / issue body)

> **🚨 CRITICAL — NEVER escape backticks with backslash (`\``) in ANY `gh` command output.**
> This rule applies to `gh pr comment`, `gh issue comment`, `gh pr create --body`, `gh issue create --body`, `gh api --field body=...`, and any other command whose output renders as GitHub Markdown.
> **Every time this rule has been violated, the resulting issue / PR / comment was visually broken on GitHub.** This happened most recently on issues #335, #336, #337 (2026-04-16). The fix was a manual `sed` pass to strip all `\`` back to `` ` ``.

### The rule

- ✅ Correct: write `` ` `` for inline code and ` ``` ` for fenced code blocks, **literally, with zero escaping**.
- ❌ Wrong: `\``, `\`\`\``. These render as **visible backslash + backtick** on GitHub — the markdown parser treats the backslash as a literal character, so there is no code formatting at all.

### Why it keeps happening and how to stop

The temptation to write `\`` comes from the shell: outside a heredoc, backticks trigger command substitution. But **every `gh` body in this repo MUST use a single-quoted heredoc** (`<<'EOF' ... EOF`). Inside a single-quoted heredoc the shell performs **zero interpolation** — backticks, `$`, `!`, and `\` are all passed through verbatim. So there is nothing to escape.

```bash
# CORRECT — single-quoted heredoc, backticks are literal
gh issue create --body "$(cat <<'EOF'
Use `createBridgeClient()` to connect.
EOF
)"

# WRONG — unquoted heredoc, shell eats the backticks
gh issue create --body "$(cat <<EOF
Use `createBridgeClient()` to connect.
EOF
)"

# ALSO WRONG — escaped backticks inside single-quoted heredoc
gh issue create --body "$(cat <<'EOF'
Use \`createBridgeClient()\` to connect.
EOF
)"
```

### Pre-send checklist (do this mentally before every `gh` call)

1. Is the heredoc **single-quoted** (`<<'EOF'`)? If yes, proceed — no escaping needed.
2. Does the body contain `\``? If yes, **STOP and remove every backslash before a backtick**. There is no scenario in a single-quoted heredoc where `\`` is correct.

## Architecture

### LLM Core

The agent loop runs via `runAgent()` in `server/agent/index.ts`. Claude decides autonomously which tools to use — built-in file tools or gui-chat-protocol plugins registered as MCP servers. The MCP server (`server/agent/mcp-server.ts`) is a stdio JSON-RPC bridge spawned by the Claude CLI via `--mcp-config`.

### Plugin Layer

Plugins follow the gui-chat-protocol standard (`ToolDefinition`, `ToolResult`, `ViewComponent`, `PreviewComponent`). Plugin registry: `src/tools/index.ts`. Plugin types: `src/tools/types.ts`.

### Roles

Defined in `src/config/roles.ts`. A role defines a persona (system prompt), a plugin palette (`availablePlugins[]`), and a context reset on switch. **MCP servers are created per role switch** — only the current role's plugins are registered.

### Server → Client Communication

SSE from `POST /api/agent`: `{ type: "status" | "tool_result" | "error", ... }`.

### Workspace

Hard-coded to `~/mulmoclaude/` (see `server/workspace/workspace.ts`). There is **no `WORKSPACE_PATH` env override**; changing the location requires a code edit or a symlink. Post-#284 the layout is grouped into four top-level buckets — full reference in [`docs/developer.md`](docs/developer.md#workspace-layout-mulmoclaude). Short version:

```text
~/mulmoclaude/
  config/              ← settings.json, mcp.json, roles/, helps/
  conversations/       ← chat/, chat/index/, memory.md, summaries/
  data/                ← wiki/, todos/, calendar/, contacts/,
                         scheduler/, sources/, transports/
  artifacts/           ← charts/, documents/, html/, html-scratch/,
                         images/, news/, spreadsheets/, stories/
```

Pre-#284 workspaces must run `yarn tsx scripts/migrate-workspace-284.ts --execute` (preceded by `--dry-run`) once before the server will start.

**Always reach for constants** (`WORKSPACE_PATHS.<key>` / `WORKSPACE_DIRS.<key>` / `WORKSPACE_FILES.<key>` from `server/workspace/paths.ts`) when composing workspace paths — never hardcode a literal. A rename is one-file edit there; hardcoded literals turn it into a grep-and-edit across the server.

### Routing (vue-router, history mode)

URL-based navigation via `vue-router` (history mode — clean paths, no `#`). The router manages session, view mode, and (in future phases) file path, result UUID, and role in the URL.

**URL scheme** (see #108 for full plan):

```text
/                                          → /chat redirect
/chat                                      → new session, single view
/chat/:sessionId                           → existing session, single view
/chat/:sessionId?view=stack                → stack view
/chat/:sessionId?view=files                → files view
/chat/:sessionId?view=files&path=wiki/foo  → files view + file selected (future)
```

**Key pattern — ref + bidirectional sync**: `router.push` is async, so state that must be readable synchronously (e.g. `currentSessionId`, `canvasViewMode`) is kept as a plain `ref`. The ref is the source of truth for reads; `router.push`/`router.replace` keeps the URL in sync. A `watch` on route params/query handles external URL changes (back/forward button, typed URL).

**Navigation guards** (`src/router/guards.ts`): `beforeEach` validates all URL params (sessionId format, view whitelist) and strips invalid values via `router.replace`.

**`navigateToSession`** in `App.vue` uses `buildViewQuery()` (from `useCanvasViewMode`) instead of raw `route.query` for the view param — this avoids a stale-query race when `setCanvasViewMode` and `navigateToSession` are called in the same synchronous block.

## Key Files

`server/` is grouped by concern (#323). Top-level directories: `agent/`, `api/`, `workspace/`, `events/`, `system/`, `utils/`.

| File | Purpose |
|---|---|
| `server/agent/index.ts` | Agent loop, MCP server creation per role |
| `server/agent/mcp-server.ts` | stdio JSON-RPC MCP bridge spawned by the Claude CLI |
| `server/agent/attachmentConverter.ts` | Converts non-native attachments (DOCX/XLSX/PPTX/text) to Claude content blocks |
| `server/api/routes/agent.ts` | `POST /api/agent` → SSE stream |
| `server/api/chat-service/` | External-bridge HTTP + socket.io surface (DI factory, `@mulmobridge/chat-service`) |
| `server/api/auth/` | Bearer token + CSRF gate (`/api/files/*` exempt for `<img>` tags) |
| `server/workspace/journal/` | Workspace journal (daily + optimization passes) |
| `server/workspace/chat-index/` | Per-session summarizer + sidebar title cache |
| `server/workspace/roles.ts` | Custom-role loader over `<workspace>/roles/` |
| `server/events/pub-sub/` | In-process publish/subscribe (socket.io-backed) |
| `server/events/session-store/` | In-memory session state + event fan-out |
| `server/events/task-manager/` | Cron-ish scheduled task runner (tick loop) |
| `server/events/scheduler-adapter.ts` | Wires `@receptron/task-scheduler` to MulmoClaude (catch-up + persistence) |
| `packages/scheduler/` | `@receptron/task-scheduler` — pure scheduler library (independent npm package) |
| `server/system/env.ts` | Single source of truth for `process.env.*` |
| `server/system/logger/` | Structured logger (console + rotating file + telemetry stub) |
| `server/utils/` | Shared helpers: `fs.ts`, `errors.ts` |
| `src/config/apiRoutes.ts` | Central `/api/*` endpoint path constants (shared by server + frontend) |
| `src/config/roles.ts` | Role definitions |
| `src/tools/index.ts` | Plugin registry |
| `src/router/index.ts` | Vue-router setup (history mode, route definitions) |
| `src/router/guards.ts` | Navigation guards (param validation + sanitize) |
| `src/composables/useCanvasViewMode.ts` | View mode state — URL sync via router, localStorage fallback |
| `src/App.vue` | Main UI — sidebar + canvas + role switcher |

## Plugin Development

Each plugin is a `ToolPlugin` (from `gui-chat-protocol/vue`, extended in `src/tools/types.ts`): `toolDefinition` + `execute()` + `viewComponent` + `previewComponent`.

### Adding a package plugin (`@gui-chat-plugin/*` or `@mulmochat-plugin/*`)

Import the canonical `TOOL_DEFINITION` directly — **do not copy or re-type the schema**. Update **4 places**:

1. `server/agent/mcp-server.ts` — import and add to `TOOL_ENDPOINTS` + `ALL_TOOLS`
2. `src/tools/index.ts` — register in the `plugins` map using `TOOL_NAME` as key
3. `src/config/roles.ts` — add to relevant role's `availablePlugins`
4. `server/agent/index.ts` — add to `MCP_PLUGINS`

Route handler goes in `server/api/routes/plugins.ts`. Add the endpoint path to `src/config/apiRoutes.ts`.

### Adding a local plugin (`src/plugins/<name>/`)

Local plugins import Vue components, so `toolDefinition` must be in a **separate file** (`definition.ts`) to allow server-side imports without pulling in Vue. Update **8 places**: `definition.ts`, `index.ts`, `server/api/routes/<name>.ts`, `server/agent/mcp-server.ts`, `src/tools/index.ts`, `src/config/roles.ts`, `server/agent/index.ts`, `src/config/apiRoutes.ts`.

> If a plugin is in `availablePlugins` but absent from `MCP_PLUGINS` or `ALL_TOOLS`, it will be silently dropped.

> The key in `src/tools/index.ts` must exactly match the tool's `name` field.

## Express Route Type Safety

MUST use Express generics to type route handlers — NEVER use `as` casts on `req.body`, `req.params`, or `req.query`.

```typescript
// GOOD — fully typed
router.post("/items/:id", (req: Request<MyParams, unknown, MyBody>, res: Response) => { ... });

// BAD — untyped, requires casts
router.post("/items/:id", (req: Request, res: Response) => { const x = req.body as MyBody; });
```

- NEVER cast `req.query` — use `typeof req.query.x === "string" ? req.query.x : undefined`
- Use type annotation (`const data: MyType = JSON.parse(raw)`) instead of `as` cast

## Centralized Constants

String literals that form cross-module contracts (endpoint paths, event types, tool names, role IDs, pub-sub channels, workspace directory names) MUST be defined once in a shared `as const` module and referenced everywhere else. NEVER introduce a new raw string literal for something that already has a constant.

| What | Source of truth | Pattern |
|---|---|---|
| API endpoint paths | `src/config/apiRoutes.ts` → `API_ROUTES` | `router.post(API_ROUTES.todos.items, ...)` / `fetch(API_ROUTES.todos.items)` |
| SSE / event types | `src/types/events.ts` → `EVENT_TYPES` / `EventType` | `{ type: EVENT_TYPES.toolResult, ... }` — also used in `AgentEvent` union |
| Workspace directories | `server/workspace/paths.ts` → `WORKSPACE_PATHS` | `path.join(WORKSPACE_PATHS.wiki, "pages")` |
| Tool names | `src/config/toolNames.ts` → `TOOL_NAMES` / `ToolName` | `availablePlugins: [TOOL_NAMES.manageTodoList, ...]` |
| Built-in role IDs | `src/config/roles.ts` → `BUILTIN_ROLE_IDS` | `if (roleId === BUILTIN_ROLE_IDS.general)` |
| Pub-sub channels | `src/config/pubsubChannels.ts` → `sessionChannel()` | `pubsub.publish(sessionChannel(id), event)` |
| SSE event types | `src/types/events.ts` → `EVENT_TYPES` / `EventType` | `event.type === EVENT_TYPES.toolCall` |

**Adding a new endpoint**: add the path to `src/config/apiRoutes.ts` first, then reference `API_ROUTES.<group>.<name>` from both the router file and the frontend `fetch()` call. Routers register the full `/api/...` path directly (no mount prefix in `server/index.ts`).

## Cross-platform considerations

CI runs the matrix `{ubuntu, windows, macOS} × {Node 22, Node 24}` (see `docs/developer.md`). Server / shared code MUST run on all three. Patches that build hardcoded POSIX paths or rely on `/tmp` semantics break Windows CI immediately and are the most common cause of red builds.

### Paths

- MUST build paths with `node:path` (`path.join`, `path.resolve`, `path.dirname`) — NEVER concatenate with literal `/` or `\\`.
- In **tests**, expected values MUST also go through `path.join()`. Do NOT hardcode `"/tmp/ws/.claude/skills"`-style strings — Windows produces `"\\tmp\\ws\\..."` and the assertion fails. Compose roots with `path.join(path.sep, "tmp", "ws")` or `os.tmpdir()`.
- For URL ↔ path conversions, use `node:url`'s `fileURLToPath` / `pathToFileURL`. NEVER manipulate `file://` strings directly.
- Workspace-relative path **comparisons** (e.g. checking that a resolved path stays under a root) MUST use `path.relative()` or `path.resolve()` then a separator-aware `startsWith` — string-prefix checks like `p.startsWith(root + "/")` are wrong on Windows.

### Filesystem semantics

- **Atomic writes**: place the tmp file alongside the final destination (`${finalPath}.${randomUUID()}.tmp`), not in `os.tmpdir()`. `os.tmpdir()` may live on a different filesystem (Docker volumes, separate `/tmp` mounts), and `rename()` across filesystems fails with `EXDEV`. The same-directory pattern is the only reliable atomic-rename idiom in Node.
- **Case sensitivity**: macOS / Windows are case-insensitive by default; Linux is case-sensitive. Treat `Foo.md` and `foo.md` as the same file when matching, never as distinct entries.
- **Symlinks**: behavior differs across platforms (Windows requires admin for some symlink types). Don't depend on symlink presence in tests; if you must test it, gate with `if (process.platform === "win32") test.skip(...)`.
- **Permissions**: `chmod(0o000)` is a no-op on Windows. Tests that simulate "unreadable file" need `if (process.platform === "win32") return;` early-return guards.
- **Line endings**: writes that round-trip through git on a Windows checkout may pick up CRLF — use `"\n"` explicitly when comparing string output, and parse with `replace(/\r\n/g, "\n")` if reading user-edited files.
- **Shell scripts in npm scripts**: NEVER use shell-specific syntax (`rm -rf`, `cp`, glob expansions in single quotes). Use `rimraf`, `shx`, or a Node script. Globs in package.json scripts should be unquoted (`prettier --write src/**/*.ts`, not `'src/**/*.ts'`).

### Why this section keeps mattering

Cross-platform path bugs land disproportionately often (multiple PRs in the last few weeks: `#224`, `#234`). The pattern is always the same: code works locally on macOS, ships, then Windows CI explodes on `\` vs `/`. Read this section once before writing any new fs / path code and the regressions go away.

## Code Organization

The repo runs several PRs in flight at once. Code that sprawls across large functions or monolithic files creates expensive merge conflicts. Keep units small so parallel PRs touch different blocks.

### Functions: small, pure, extractable

- Extract pure logic into exported helpers so unit tests can exercise them without a harness. Examples: `parseRange` / `classify` / `isSensitivePath` in `server/api/routes/files.ts`, `normalizeTopicAction` / `computeJustCompletedSessions` in `server/workspace/journal/dailyPass.ts`.
- Prefer discriminated-union return types (`{ kind: "skipped", reason } | { kind: "processed", ... }`) over null / thrown errors for multi-outcome helpers.
- Honour the `sonarjs/cognitive-complexity` threshold (**error at >15** in `.ts` / `.js`; temporarily **warn** in `.vue` until pre-existing violations like `App.vue#sendMessage` at 47 and `spreadsheet/View.vue` at 163 are refactored). Split rather than suppress.

### Utility functions: group by concern under `utils/`

Reusable pure functions MUST be placed under `server/utils/` or `src/utils/` and grouped into files by semantic concern — NOT dumped into a single `utils.ts` / `helpers.ts`. When adding a new utility, find (or create) the file whose name matches the concern:

```text
server/utils/
  fs.ts            ← file / path operations (resolveWithinRoot, statSafe, …)
  errors.ts        ← error message extraction
  httpError.ts     ← Express response helpers (badRequest, serverError, …)
  slug.ts          ← string slugification
  gemini.ts        ← Gemini API wrappers

src/utils/
  api.ts           ← apiGet / apiPost / apiPut / … (network)
  errors.ts        ← errorMessage (shared with server)
  format/          ← date formatting, number formatting
  session/         ← mergeSessions, sessionEntries (session-specific logic)
  image/           ← image URL rewriting
  path/            ← workspace-relative link resolution
  dom/             ← DOM helpers (scroll, external-link detection)
  tools/           ← tool-result type guards, pending-call state
  role/            ← role icon / name resolution
  files/           ← file-tree expand state
  agent/           ← agent request building, tool-call helpers
```

**Rule of thumb**: if a function operates on a specific data type (file, string, array, network response, DOM element), it belongs in the file named for that type. If no file exists yet, create one. NEVER add unrelated functions to an existing file just because it's already imported nearby.

### Linting covers .vue files

`eslint-plugin-vue` + `vue-eslint-parser` are enabled (`eslint.config.mjs`). The `.vue` override block at the end of the config:

- demotes `vue/multi-word-component-names` to off — the `View` / `Preview` component names are the MulmoClaude plugin convention
- demotes `sonarjs/cognitive-complexity`, `sonarjs/slow-regex`, and `vue/no-v-html` to **warn** because pre-existing violations would otherwise block CI
- keeps `vue/attributes-order` / `vue/attribute-hyphenation` as warn (auto-fixable)

Each warn-level rule is a follow-up target — when all violations in `.vue` are fixed, re-raise to `error` in the override block. The goal is parity with `.ts` files.

### DRY: eliminate duplication aggressively

When the same 3+ line pattern appears in two or more files, extract a shared helper immediately — don't wait for a third copy. Place helpers in named files under the right directory (`server/utils/files/`, not inlined in the first consumer). Before writing new boilerplate, grep the codebase — it probably already exists in `server/utils/` or `src/utils/`.

Key shared helpers in this repo:

| Helper | Location |
|---|---|
| `API_ROUTES` | `src/config/apiRoutes.ts` |
| `EVENT_TYPES` / `EventType` | `src/types/events.ts` |
| `WORKSPACE_PATHS` / `WORKSPACE_DIRS` | `server/workspace/paths.ts` |
| `TOOL_NAMES` / `ToolName` | `src/config/toolNames.ts` |
| `BUILTIN_ROLE_IDS` / `BuiltInRoleId` | `src/config/roles.ts` |
| `PUBSUB_CHANNELS` / `sessionChannel()` | `src/config/pubsubChannels.ts` |
| `EVENT_TYPES` / `EventType` | `src/types/events.ts` |
| `writeFileAtomic` / `writeFileAtomicSync` | `server/utils/files/atomic.ts` |
| `readWorkspaceText` / `writeWorkspaceText` | `server/utils/files/workspace-io.ts` |
| `readWorkspaceJson` / `writeWorkspaceJson` | `server/utils/files/workspace-io.ts` |
| `resolveWithinRoot(root, relPath)` | `server/utils/files/safe.ts` |
| `statSafe` / `readDirSafe` | `server/utils/files/safe.ts` |
| `loadJsonFile` / `saveJsonFile` | `server/utils/files/json.ts` |
| `errorMessage(err)` | `server/utils/errors.ts` |
| `dispatchResponse(res, result)` | `server/api/routes/dispatchResponse.ts` |
| `useFreshPluginData(opts)` | `src/composables/useFreshPluginData.ts` |
| `useCanvasViewMode(opts)` | `src/composables/useCanvasViewMode.ts` |
| `applyViewToQuery(query, mode)` | `src/composables/useCanvasViewMode.ts` |

Periodically audit for duplication (`sonarjs/no-duplicate-string` warnings, `jscpd`). Batch low-risk extractions into a single refactor PR (as #145 did).

### File I/O — domain I/O modules (#366)

**NEVER use raw `fs.readFile` / `fs.writeFile` / `path.join` in route handlers or business logic.** All workspace file I/O MUST go through domain-specific I/O modules under `server/utils/files/`. This prevents path bugs when directories are renamed (like #284).

**Where to put what:**

| Layer | Location | Example |
|---|---|---|
| **Domain I/O** (highest) | `server/utils/files/<domain>-io.ts` | `readSessionMeta(id)`, `saveTodos(items)`, `writeDailySummary(date, content)` |
| **Generic workspace I/O** | `server/utils/files/workspace-io.ts` | `readWorkspaceText(relPath)`, `writeWorkspaceJson(relPath, data)` |
| **Atomic primitives** | `server/utils/files/atomic.ts` | `writeFileAtomic(absPath, content)` |
| **Safe wrappers** | `server/utils/files/safe.ts` | `resolveWithinRoot(root, relPath)`, `readTextSafeSync(absPath)` |
| **Path constants** | `server/workspace/paths.ts` | `WORKSPACE_DIRS.chat`, `WORKSPACE_FILES.todosItems` |

**Adding a new domain I/O module:**

1. Create `server/utils/files/<domain>-io.ts`
2. Functions take **IDs and data** as arguments, never paths — e.g. `readSessionMeta(id)` not `readFile(path.join(WORKSPACE_PATHS.chat, id + ".json"))`
3. All functions take optional `root?: string` parameter for test DI (defaults to `workspacePath`)
4. Reads return `null` / fallback on ENOENT; log + return fallback on JSON corruption (never crash)
5. Writes go through `writeFileAtomic` (atomic safety)
6. Export from `server/utils/files/index.ts` barrel

**Existing domain I/O modules:**

| Module | Functions |
|---|---|
| `session-io.ts` | `readSessionMeta`, `createSessionMeta`, `backfillFirstUserMessage`, `setClaudeSessionId`, `clearClaudeSessionId`, `updateHasUnread`, `readSessionJsonl`, `appendSessionLine`, `ensureChatDir` |
| `todos-io.ts` | `loadTodos`, `saveTodos`, `loadColumns`, `saveColumns` |
| `scheduler-io.ts` | `loadSchedulerItems`, `saveSchedulerItems` |
| `html-io.ts` | `readCurrentHtml`, `writeCurrentHtml` |
| `journal-io.ts` | `readDailySummary`, `writeDailySummary`, `readTopicFile`, `writeTopicFile`, `appendOrCreateTopic`, `readJournalState`, `writeJournalState`, `writeJournalIndex`, `listTopicSlugs`, `archiveTopic`, `listDailyFiles`, `countArchivedTopics` |

### Network I/O — centralized API helpers

**Frontend → Server**: All HTTP calls from Vue MUST go through `src/utils/api.ts` (`apiGet`, `apiPost`, `apiPut`, `apiPatch`, `apiDelete`, `apiCall`). These attach the #272 bearer token automatically. NEVER use raw `fetch("/api/...")` in `.vue` or composable files.

**MCP Server → Server**: The MCP subprocess uses `postJson()` in `server/agent/mcp-server.ts` which attaches `AUTH_HEADER`. NEVER add a raw `fetch` call in mcp-server.ts without the auth header.

**Server → External APIs**: Use `AbortController` for timeouts. Handle both network errors (try/catch) and HTTP errors (`!response.ok`). Surface errors to the user in the UI where appropriate.

### Files: one concept per file

- Name files for the concept they contain — **not** generic `utils.ts` / `helpers.ts` / `common.ts` (conflict magnets).
- Split at ~500 lines or when two concepts are touched independently by parallel PRs.
- No re-export barrel files (`index.ts` that re-exports siblings) without specific reason.

### Directories: the name is the contract

Looking at a directory name should predict what's inside:

```text
server/                     ← 6 topical dirs + index.ts + tsconfig.json (#323)
  index.ts                  ← entry point (bootstrap + route mounting)
  agent/                    ← Claude subprocess + MCP
    index.ts                ← runAgent, the agent orchestrator
    mcp-server.ts           ← stdio MCP bridge spawned by Claude CLI
    mcp-tools/              ← auto-registered non-GUI MCP tools
    config.ts, prompt.ts, stream.ts, resumeFailover.ts, sandboxMounts.ts, attachmentConverter.ts
  api/                      ← everything external clients touch
    routes/                 ← one file per /api/* surface
    chat-service/           ← bridge HTTP + socket.io
    auth/                   ← bearer token + middleware
    csrfGuard.ts
  workspace/                ← workspace-facing background processors + seed data
    workspace.ts, paths.ts, roles.ts
    helps/                  ← seed files copied into <workspace>/helps/
    journal/, chat-index/, wiki-backlinks/, sources/, skills/, tool-trace/
  events/                   ← in-process event plumbing
    pub-sub/, session-store/, task-manager/
  system/                   ← bootstrap + platform + logging
    env.ts, config.ts, docker.ts, credentials.ts
    logger/, logs/          (logs/ is gitignored runtime output)
  utils/                    ← shared helpers, one file per concept

packages/                   ← @mulmobridge/* npm packages (yarn workspaces)
  protocol/                 ← shared types + constants (EVENT_TYPES, Attachment)
  client/                   ← socket.io client + token reader + MIME utils
  chat-service/             ← server-side chat service (DI factory)
  cli/                      ← interactive terminal bridge
  telegram/                 ← Telegram bot bridge

src/
  components/     ← shared Vue components
  composables/    ← Vue 3 composables
  config/         ← static config (roles, system prompts)
  router/         ← vue-router setup + navigation guards
  plugins/<name>/ ← one dir per plugin (definition, index, View, Preview)
  tools/          ← plugin registry + types
  types/          ← shared type definitions
  utils/          ← grouped by concern (dom/, format/, path/, role/)

test/             ← mirrors source layout 1:1
e2e/              ← Playwright E2E tests + fixtures
plans/            ← one file per feature/refactor/fix
plans/done/       ← completed plans (moved here when the PR lands)
```

- **Plan files lifecycle**: create under `plans/` before implementation; move to `plans/done/` in the PR that completes the work. Never delete — `plans/done/` is the archive.
- Group by *what files are about*, not file kind. `src/plugins/wiki/` keeps def/index/View/Preview together.
- Mirror source layout in `test/`. `server/workspace/journal/dailyPass.ts` → `test/journal/test_dailyPass.ts`.
- Prefer a new named directory over dropping files into the closest pre-existing bucket.

## E2E Testing (Playwright)

Browser-based tests in `e2e/`. No backend server required — all `/api/*` calls are intercepted with `page.route()` and served from fixtures.

### Structure

```text
e2e/
  playwright.config.ts    ← Chromium-only, auto-starts vite dev client
  fixtures/
    api.ts                ← mockAllApis(page) — shared API mock helper
    sessions.ts           ← session data fixtures
  tests/
    smoke.spec.ts         ← app loads, input works
    router-guards.spec.ts ← URL injection defence
```

### Writing tests

1. Call `await mockAllApis(page)` before `page.goto()` — it intercepts all API routes
2. Use `data-testid` attributes for element selection (change-resistant) — see "Selector stability" below
3. Use URL assertions for router behaviour (`expect(page.url()).toContain(...)`)
4. Override specific API responses per test by adding a `page.route()` AFTER `mockAllApis` (Playwright checks last-registered first)

### Selector stability — avoid layout-dependent tests

E2E tests MUST survive **layout** changes (moving an element from sidebar to canvas, regrouping buttons, etc.) without being rewritten. Tests break the moment they walk the DOM structure instead of addressing elements by role.

**Rules:**

1. **Every element that an E2E test touches MUST carry a `data-testid`.** Source of truth is the Vue template — add the testid when you add the element, not when a test needs it. Missing testid = add it in the same PR.
2. **Name testids by function, not position.** `chat-input`, `send-btn`, `role-selector-btn`, `plugin-toolbar-todos` — not `left-sidebar-input`, `top-bar-right-button`. The whole point is that layout can change without renaming.
3. **Never use raw tag / structural CSS locators** (`page.locator("textarea")`, `page.locator('button:has(span.material-icons:text("send"))')`, `page.locator("div > div:nth-child(2)")`). These break on any layout tweak.
4. **Layout-shift PRs (moving an element) MUST NOT rename testids.** Move the DOM node; the testid travels with it. If a rename is genuinely needed, do it in a separate PR so the layout diff stays minimal.
5. **Reusable interactions go in `e2e/fixtures/chat.ts`** (and sibling fixture files). Tests call `sendChatMessage(page, "hi")`, `switchRole(page, "general")` etc. — when a layout change breaks the underlying testid hunt, only the helper needs updating, not every test. Drop to `page.getByTestId(...)` inline only when the interaction is one-off and no helper fits.
6. **Content-based locators** (`page.locator("text=Hello")`, `img[alt='chart']`) are fine for asserting rendered output, but NOT for navigation. Prefer testid for clicks / fills; content selectors for `toBeVisible` / `toHaveText` assertions.

### When to add E2E coverage

**Whenever a `.vue` component is modified**, consider whether the change needs a new E2E test. Unit tests cover the extracted pure helpers; E2E tests are the regression safety-net for the Vue component's wiring (template bindings, event handlers, reactive state flow, router integration). Concrete triggers:

- Touching `src/App.vue` — almost always add / extend a scenario in `e2e/tests/chat-flow.spec.ts` (the refactor flow).
- Touching a plugin's `View.vue` / `Preview.vue` — add or extend the plugin-specific spec (e.g. `file-explorer.spec.ts`, `image-plugins.spec.ts`).
- Adding a new route or changing guard logic — `router-navigation.spec.ts` / `router-guards.spec.ts`.
- Changing SSE event handling, session loading, or sidebar session merging — `chat-flow.spec.ts` already exercises these; add a case if a new event type / selection rule / merge path is introduced.

Skip if the change is purely cosmetic (Tailwind class tweaks, copy fixes, emoji swaps) with no behavioural path touched.

### Gotchas

- **Route order is reversed**: Playwright checks routes last-registered-first. Register catch-all FIRST, specific routes AFTER.
- **URL predicate functions > globs**: `**/api/roles` doesn't reliably match `http://host/api/roles`. Use `(url) => url.pathname === "/api/roles"` instead.
- **Hash vs history mode**: Tests that assert URL query params behave differently between hash mode (`/#/chat?view=x`) and history mode (`/chat?view=x`). Write tests against the rendered UI state rather than raw URL strings when possible.

## Manual Testing

Some behaviours can't be covered by E2E — drag-and-drop via `vuedraggable` / Sortable, HTML canvas pixel state, iframe-sandboxed content, LLM-driven agent flows that require a real backend, etc. Those live in [`docs/manual-testing.md`](docs/manual-testing.md), which is the single source of truth for the out-of-E2E surface.

**Contract for PRs**:

- MUST update [`docs/manual-testing.md`](docs/manual-testing.md) whenever a change deliberately leaves a scenario uncovered by E2E — add an entry with the flow, the reason it can't be automated, and how to smoke-check it.
- MUST remove / strike-through an entry when a change brings a previously-manual scenario under E2E coverage.
- Per-PR smoke-test notes go in the PR description, NOT in this doc. The doc is for *persistent* manual-test obligations only.

See `plans/` entries and past PR descriptions (#193 wiki-backlinks, #195 tool-trace, #209 todo-items-crud) for examples of cleanly separating "E2E covers this" from "manual check after each release covers this".

## Server Logging

The server uses the structured logger at `server/system/logger/`. **Never call `console.*` directly outside that module** — import and use `log.{error,warn,info,debug}(prefix, msg, data?)` instead.

```ts
import { log } from "../logger/index.js";

log.info("my-module", "did a thing", { count: 3 });
log.error("my-module", "operation failed", { error: String(err) });
```

- `prefix` is lowercase, hyphenated, no brackets (the text formatter adds `[ ]`)
- Put structured values in the `data` payload, not interpolated into `msg` — the JSON file format depends on it
- Console default is `info`/`text`; file default is `debug`/`json` rotating daily under `server/system/logs/`
- Full reference (env vars, formats, rotation, recipes): [`docs/logging.md`](docs/logging.md)

The only remaining `console.*` call is `server/system/logger/sinks.ts`'s fallback path for when the file sink itself errors.

## Tech Stack

- **Frontend**: Vue 3 + Tailwind CSS v4
- **Agent**: `@anthropic-ai/claude-agent-sdk`
- **Plugin protocol**: `gui-chat-protocol`
- **Server**: Express.js (SSE streaming)
- **Storage**: Local file system (plain Markdown files)
- **E2E Testing**: Playwright (Chromium)
- **Language**: TypeScript throughout

## exe.dev 固有の変更（upstream merge 時に維持すること）

このリポジトリは https://github.com/receptron/mulmoclaude のフォーク。
upstream merge でコンフリクトした場合は以下の変更を exe.dev 側に保つ。

| ファイル | 変更内容 | 理由 |
|---------|---------|------|
| `server/index.ts` L276–285 | `sandboxEnabled` 時の Docker ブリッジ IP 二次リスナー | Docker コンテナ内 MCP → ホスト HTTP の到達性確保 |
| `server/docker.ts` | `getDockerBridgeIp()` | docker0 インターフェースの取得（Node の networkInterfaces が DOWN を無視するため） |
| `server/csrfGuard.ts` | `isAllowedOrigin()`, `EXTRA_ALLOWED_ORIGINS`, `EXTRA_ALLOWED_HOSTS` | exe.dev リバースプロキシ経由アクセスの CSRF 許可 |
| `vite.config.ts` | `VITE_PORT` / `VITE_ALLOWED_HOSTS` の env 読み取り | exe.dev ポート要件（デフォルト 8000）とホスト名の外部化 |
| `e2e/playwright.config.ts` | `VITE_PORT` からのポート読み取り | テスト環境ポートの統一 |

### upstream merge の手順

```bash
git fetch upstream
git log upstream/main ^main --oneline   # 差分を確認
git merge upstream/main
# コンフリクト解決（上記テーブルを参照）
yarn format && yarn lint && yarn typecheck && yarn build
```
