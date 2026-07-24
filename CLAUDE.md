# CLAUDE.md

This file provides guidance to Claude Code when working with the MulmoClaude repository.

## Project Overview

MulmoClaude is a text/task-driven agent app with rich visual output. It uses **Claude Code Agent SDK** as the LLM core and **gui-chat-protocol** as the plugin layer. Shared code is published as `@mulmobridge/*` npm packages under `packages/`.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

## Key Commands

- **Dev server**: `npm run dev` (runs both client and server concurrently)
- **Lint**: `yarn lint` / **Format**: `yarn format` / **Typecheck**: `yarn typecheck` / **Build**: `yarn build`
- **Unit tests**: `yarn test` (node:test, server handlers + utils)
- **E2E tests**: `yarn test:e2e` (Playwright, browser UI tests — no backend needed)

**IMPORTANT**: After modifying any source code, always run `yarn format`, `yarn lint`, `yarn typecheck`, and `yarn build` before considering the task done.

**IMPORTANT**: Always write error handling for all `fetch` calls. Handle both network errors (try/catch) and HTTP errors (`!response.ok`).

## Key Rules (always apply)

### Shared utilities — check before reinventing

Before writing a new helper, scan [`docs/shared-utils.md`](docs/shared-utils.md). If a similar helper exists, use it. When you add a new shared helper, append a 1-line entry to that catalog **in the same PR**. Skipping this is how `truncate()` ended up with 6 implementations (#1304).

### Constants — no magic literals

- **Time**: NEVER use raw numbers (`1000`, `60000`, `3600000`). Import from `server/utils/time.ts`
- **Strings**: scheduler types, event types, API routes, tool names — use existing `as const` objects
- **Paths**: use `WORKSPACE_PATHS` / `WORKSPACE_DIRS` / `WORKSPACE_FILES` — never hardcode

### File I/O — domain modules only

NEVER use raw `fs.readFile` / `fs.writeFile` in route handlers. Use `server/utils/files/<domain>-io.ts`. All writes go through `writeFileAtomic`.

### Network I/O — centralized helpers

- **Frontend → Server**: use `src/utils/api.ts` (`apiGet`, `apiPost`, etc.) — auto-attaches bearer token
- **MCP → Server**: use `postJson()` with `AUTH_HEADER`
- **Server → External**: use `AbortController` for timeouts, check `response.ok`

### Cross-platform

- Build paths with `node:path` (`path.join`, `path.resolve`) — NEVER concatenate `/`
- Atomic writes: tmp file alongside destination, not in `os.tmpdir()`
- Package exports: include `"require"` and `"default"` conditions (Docker CJS mode)

### Code style

- Functions under 20 lines; split into smaller functions if needed
- `const` over `let`; never `var`
- Extract pure logic into exported helpers for testability
- Honour `sonarjs/cognitive-complexity` threshold (error at >15)
- No re-export barrel files without specific reason

### GitHub posts

NEVER escape backticks with `\`` in `gh` commands. Use single-quoted heredoc (`<<'EOF'`).

### Error-recovery know-how — keep `error-recovery.md` in sync

When you (or a PR you're reviewing) adds a new diagnostic / fix for a recurring failure mode — sandbox auth, build ordering, plugin install, anything the agent might hit at runtime — also add a section (or extend an existing one) in [`packages/core/assets/helps/error-recovery.md`](packages/core/assets/helps/error-recovery.md). The agent reads that file BEFORE asking the user a clarifying question on a tool failure (see the "When a tool call fails" section in `server/prompts/system/system.md`), so know-how that lives only in a PR description / commit message / `docs/` is invisible to it. Bump `@mulmoclaude/core` whenever `assets/helps/*` changes (it ships to npm via `files: ["dist", "assets"]`).

### Edit-time deeper rules (read when relevant)

- **Lint warnings + `eslint-disable` etiquette** → [`docs/lint-policy.md`](docs/lint-policy.md)
- **UI control sizes + chrome row layout** → [`docs/ui-controls.md`](docs/ui-controls.md)
- **UI region naming + testid discipline + when to update layout art** → [`docs/ui-cheatsheet.md`](docs/ui-cheatsheet.md) (also the source of truth for the ASCII layout map)
- **i18n (all 8 locales in lockstep, add / rename / remove keys, new locale registration)** → [`docs/i18n.md`](docs/i18n.md)
- **Reproducing Windows-host FS bugs inside Linux Docker containers on CI** (dangling NTFS junctions, WSL2 + native `dockerd` setup, gotchas) → [`docs/windows-docker-ci.md`](docs/windows-docker-ci.md)

## Package dependency direction (always apply)

The monorepo has three package families. **Dependencies flow in ONE direction only** — violating this creates uphill imports, parallel-build races, and the tier-ordering dance that #1789 / #1795 had to dismantle.

```
                       ▲ depends on
                       │
        host           │   (server/, src/, packages/mulmoclaude)
        ──────         │
        plugins        │   (packages/plugins/*-plugin)
        ──────         │
   shared core         │   (@mulmoclaude/core — formerly the 7 packages/services/*)
                       │
        no deps        │   (leaf libs: @mulmobridge/protocol, @receptron/task-scheduler, etc.)
                       │
```

**Rules:**

- A **plugin** (`packages/plugins/<name>-plugin`) MAY import `@mulmoclaude/core/<subpath>` (or any leaf lib). It MUST NOT import another `*-plugin`. Cross-plugin sharing goes through core.
- **Shared core** (`@mulmoclaude/core` — provides `./collection`, `./collection/server`, `./collection-watchers`, `./skill-bridge`, `./notifier`, `./scheduler`, `./whisper`, `./whisper/client`, `./workspace-setup`, `./workspace-setup/slug`, `./file-change-publisher`) MUST NOT import any `*-plugin`. If a plugin owns code that core / another plugin needs, **pull it OUT of the plugin into core** (the `isSafeActionTemplatePath` / `discoverCollections` extraction in #1795 is the canonical pattern), don't import uphill.
- **Browser-safe surfaces of core** stay on dedicated subpaths (`@mulmoclaude/core/whisper/client`, `@mulmoclaude/core/workspace-setup/slug`). Everything else under `@mulmoclaude/core/*` is server-only.
- **Host** (`server/`, `src/`, `packages/mulmoclaude`) MAY import anything below it. Host code stays generic — provider-specific code belongs in the relevant plugin, not in `server/`.

When the build complains "Cannot find module `@mulmoclaude/foo`" cold, the cause is almost always an uphill or peer import. **Don't patch with a new tier or a `--first=foo` flag** — surface the import and move the code instead. Plan record: [`plans/done/refactor-shared-core.md`](plans/done/refactor-shared-core.md).

## Server Logging

Use `log.{error,warn,info,debug}(prefix, msg, data?)`. Never call `console.*` directly. Full reference: [`docs/logging.md`](docs/logging.md).

## Architecture (quick map)

| File | Purpose |
|---|---|
| `server/agent/index.ts` | Agent loop, MCP server creation |
| `server/agent/mcp-server.ts` | stdio JSON-RPC MCP bridge |
| `server/api/routes/agent.ts` | `POST /api/agent` → SSE stream |
| `server/workspace/paths.ts` | Workspace path constants |
| `server/utils/time.ts` | Time constants + timeout presets |
| `src/config/apiRoutes.ts` | API endpoint path constants |
| `src/config/roles.ts` | Role definitions |
| `src/App.vue` | Main UI |

Full layout + workspace tree + process map: [`docs/developer.md`](docs/developer.md).

## When you do certain tasks (read the dedicated doc)

| Task | Doc |
|---|---|
| **Create or edit a plugin** | [`docs/plugin-development.md`](docs/plugin-development.md) (built-in + runtime, scaffold sync, host aggregators, "extract shared code into core" recipe) |
| **Add a workspace package, debug a tier order issue** | [`docs/build-orchestration.md`](docs/build-orchestration.md) |
| **Release the app** (`vX.Y.Z`) | `/release-app` skill |
| **Publish `mulmoclaude` to npm** | `/publish-mulmoclaude` skill |
| **Publish a shared `@mulmoclaude/*` or `@mulmobridge/*` npm package** | `/publish` skill — tag `@scope/name@X.Y.Z` (no `v`), GH release with `--latest=false` |
| **Add / write an e2e test** (mock or live) | [`docs/developer.md#e2e-testing-playwright`](docs/developer.md#e2e-testing-playwright) for mock, [`docs/e2e-live-testing.md`](docs/e2e-live-testing.md) for live (must-read before adding a `e2e-live/tests/*.spec.ts`) |
| **Manual-test scenarios that can't be automated** | [`docs/manual-testing.md`](docs/manual-testing.md) |
| **Work on remote host** (drive MulmoClaude from a phone over the Firestore command channel) | [`docs/remote-host.md`](docs/remote-host.md) (auth model, command loop, handler table, mobile custom-view postMessage bridge) |
| **Reference the centralised constants** (`API_ROUTES`, `TOOL_NAMES`, `WORKSPACE_DIRS`, `PUBSUB_CHANNELS`, `EVENT_TYPES`, `SCHEDULE_TYPES`) | [`docs/developer.md#centralized-constants`](docs/developer.md#centralized-constants). For the four plugin-aware aggregators, edit the plugin's `meta.ts` — never the host record. |

### `chore(release)` commits — never bump the launcher preemptively

A `chore(release)` commit that publishes a shared workspace package (e.g. `@mulmoclaude/core`, `@mulmoclaude/collection-plugin`) MUST bump only that package's `version` and the launcher's DEP RANGE for it (to keep the `launcherSync.mjs` workspace-lockstep invariant green). It MUST NOT bump the launcher's OWN `version` field — that field is reserved for the `/publish-mulmoclaude` workflow that actually publishes the npm launcher.

Rationale: the launcher-sync gate enforces `launcherRange.lowerBound == workspace.version` for dep ratchet, but it never touches or checks the launcher's OWN `version`. Bumping the launcher preemptively "for tidiness" while skipping the actual npm publish creates a silent drift where `packages/mulmoclaude/package.json` runs ahead of npm's latest — future readers can't tell what the next actual publish should be, and end up either skipping the drafted-but-unpublished identity (leaving numbering gaps) or publishing a version whose intent no longer matches the current code. See #1945 for the pattern that motivated this rule.

When to bump `packages/mulmoclaude/package.json`'s `version`:
- Inside the `/publish-mulmoclaude` flow, right before the actual `npm publish`. That commit becomes the identity of the release.
- Never as part of a `chore(release)` that publishes only shared packages.

### Internal dep ranges — always track the latest published version

Every declared range on a workspace-internal package (`@mulmoclaude/*`, `@mulmobridge/*`, `mulmoclaude`) MUST equal `^<latest version published to npm>`, in **every** `package.json` that declares it — `dependencies`, `devDependencies` and `peerDependencies` alike, in bridges and plugins, not just the launcher.

Whenever you publish a workspace package, sweep every consumer's range to the new version in the same PR.

Rationale: a caret range on a `0.x` package does **not** float across minor versions — `^0.23.0` resolves to `>=0.23.0 <0.24.0`. So a stale range doesn't merely look untidy, it *pins consumers to an old line* and silently withholds everything published since. This is not hypothetical: `mulmoclaude@1.3.0` shipped `@mulmoclaude/core: ^0.23.0` while npm had already served 0.24 through 0.28, so npm-installed users could not receive any of it. The `launcherSync.mjs` gate only checks the launcher, so nothing catches the same drift in the other ~50 workspaces.

To audit before a release:

```bash
# for each internal dep name, compare every declared range against npm's latest
npm view <pkg> version --registry https://registry.npmjs.org/
```

A range update reaches users only through that consumer's own next release, so it does not force an immediate republish of all 50 packages — but it MUST be in the tree before the consumer is published next.
