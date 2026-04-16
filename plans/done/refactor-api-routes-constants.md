# refactor: centralize `/api/*` endpoint paths into `src/config/apiRoutes.ts` (issue #289, part 1)

## Context

Issue [#289](https://github.com/receptron/mulmoclaude/issues/289) — **chore: ソース全体に分散している文字列リテラル・定数を集約** — tracks six follow-ups to PR #287 (workspace-paths). This PR is **part 1**: the `/api/*` endpoint paths.

Currently:

- Frontend: `fetch("/api/...")` across ~57 call sites (`.vue`, `.ts`).
- Backend: `router.post("/api/...")` / `app.use("/api", ...)` across 19 route files.
- 77 route registrations today, mounted either at `/api` (18 routers) or `/api/mcp-tools` (1 router).
- The contract is bidirectional but both ends are raw string literals — a typo produces a runtime 404, never a TypeScript error.

## Scope for this PR

**Server only.** The issue lists "frontend + backend" migration as the end state, but the Vue side conflicts with in-flight PR #279 (`refactor/consolidate-api-fetch`), so:

1. Add `src/config/apiRoutes.ts` as the shared source of truth with every `/api/...` path the server exposes.
2. Migrate all 77+1 server route registrations (router files + `server/index.ts` health check + mcp-tools) to reference the constants.
3. Leave `fetch("/api/...")` calls in `src/**/*.vue` / `src/**/*.ts` untouched. Follow-up PR after #279 merges.

## Design decisions

### Full paths, drop the mount prefix

The issue proposes:

```ts
export const API_ROUTES = {
  sources: { manage: "/api/sources/manage" },
} as const;
```

and `router.post(API_ROUTES.sources.manage, ...)`. That only works if routers register **full** paths, not relative-to-mount-point. So:

- `app.use("/api", agentRoutes)` → `app.use(agentRoutes)`
- `app.use("/api/mcp-tools", mcpToolsRouter)` → `app.use(mcpToolsRouter)`
- Each router registers its full path: `router.post("/api/agent/cancel", ...)`.

Behaviour is identical — Express routes at root do the same matching. The only functional difference is that the `/api` prefix is literal in every `router.{get,post,...}` call rather than shared via the mount. The constants module ensures it's typed exactly once.

### Structure: flat-ish nested objects by resource family

Mirrors `server/workspace/paths.ts` (#287). Top-level keys group by owning route file; nested keys match the last segment.

```ts
export const API_ROUTES = {
  health: "/api/health",
  agent: {
    run: "/api/agent",
    cancel: "/api/agent/cancel",
    internal: {
      toolResult: "/api/internal/tool-result",
      switchRole: "/api/internal/switch-role",
    },
  },
  files: {
    tree: "/api/files/tree",
    dir: "/api/files/dir",
    content: "/api/files/content",
    raw: "/api/files/raw",
  },
  // …
} as const;
```

### Express params → `:param` strings

Patterns like `/todos/items/:id` stay as Express pattern strings. Frontend URL-building helpers (e.g. `(id: string) => \`/api/todos/items/${id}\``) are NOT added in this PR — they would only be exercised by the Vue code that this PR intentionally leaves alone.

### `/api/mcp-tools/:tool` lives in the same tree

Previously `app.use("/api/mcp-tools", mcpToolsRouter)` with internal `router.get("/", ...)` / `router.post("/:tool", ...)`. After: mounted at root, and uses full paths from `API_ROUTES.mcpTools.list` / `API_ROUTES.mcpTools.invoke`.

## Out of scope

- Frontend `fetch("/api/...")` rewrites (blocked by #279; follow-up PR).
- Route rename / restructure (pure move, nothing changes URLs).
- Param-building helpers for clients (not needed until Vue migrates).
- The other five sub-tasks of #289 (event types, env, tool names, role IDs, pub-sub channels) — each its own PR.

## Verification

- `yarn typecheck` / `yarn lint` / `yarn build`
- `yarn test` — every server handler test hits a real path, so any mismatch between constant and registered route lights up immediately.
- `yarn test:e2e` — Playwright mocks are pinned to literal `/api/...` URL patterns; they should keep passing because we're not changing what the server responds to, only how the server spells it in code.

## Checklist

- [ ] `src/config/apiRoutes.ts` created
- [ ] `server/index.ts` mount prefix removed + health check uses const
- [ ] 19 router files migrated (+ mcp-tools)
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build`
- [ ] `yarn test`
- [ ] `yarn test:e2e`
- [ ] PR referencing #289 (part 1)
