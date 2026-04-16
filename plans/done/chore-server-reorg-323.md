# chore(server): reorganize flat layout into 6 topical dirs (#323)

## Goal

Reduce `server/` top-level entries from 30 → 8 (`index.ts`, `tsconfig.json`, and 6 directories). Each directory name predicts what's inside. Pure file moves + import updates — no behaviour change.

## Target layout

```text
server/
  index.ts              ← entry point (stays)
  tsconfig.json         ← stays

  agent/                ← Claude subprocess + MCP
    agent/index.ts      ← was server/agent.ts (runAgent + runtime glue)
    mcp-server.ts       ← was server/mcp-server.ts
    mcp-tools/          ← was server/mcp-tools/
    plugin-names.ts     ← was server/plugin-names.ts
    config.ts           ← existing
    prompt.ts           ← existing
    stream.ts           ← existing
    resumeFailover.ts   ← existing
    sandboxMounts.ts    ← existing (#259)

  api/                  ← everything external clients touch
    routes/             ← was server/routes/
    chat-service/       ← was server/chat-service/
    auth/               ← was server/auth/
    csrfGuard.ts        ← was server/csrfGuard.ts

  workspace/            ← workspace-facing background processors + seed data
    workspace.ts        ← was server/workspace.ts
    paths.ts            ← was server/workspace-paths.ts
    roles.ts            ← was server/roles.ts (loader for <ws>/roles/)
    helps/              ← was server/helps/ (seed files copied into <ws>/helps/)
    journal/            ← was server/journal/
    chat-index/         ← was server/chat-index/
    wiki-backlinks/     ← was server/wiki-backlinks/
    sources/            ← was server/sources/
    skills/             ← was server/skills/
    tool-trace/         ← was server/tool-trace/ (writes events into the ws jsonl)

  events/               ← in-process event plumbing
    pub-sub/            ← was server/pub-sub/
    session-store/      ← was server/session-store/
    task-manager/       ← was server/task-manager/

  system/               ← bootstrap + platform + logging
    env.ts              ← was server/env.ts
    config.ts           ← was server/config.ts
    docker.ts           ← was server/docker.ts
    credentials.ts      ← was server/credentials.ts
    logger/             ← was server/logger/
    logs/               ← was server/logs/

  utils/                ← unchanged
```

## Scope

- `git mv` every file listed above. `agent.ts` lands as `agent/index.ts` because ES-module dir convention + it's the agent orchestrator.
- Update every cross-module `import "../.."` path. Most imports gain or lose one `..` segment; a script resolves each import to its absolute path, looks it up in the move map, rewrites relative to the new location.
- Update path strings used at runtime — currently just `workspace.ts`'s `TEMPLATES_DIR = path.join(__dirname, "helps")` (helps moved along with workspace.ts so relative lookup stays correct).
- Update `CLAUDE.md`, `docs/developer.md`, `docs/logging.md`, and any `plans/*.md` that reference moved paths.

## Non-goals

- No behaviour change.
- No file splits / merges.
- No changes under `test/`, `src/`, `e2e/`, or `scripts/` other than import path updates.

## Risk

Merge conflicts with any in-flight PR that touches server files. We do this when the queue is quiet; the refactor itself is mechanical.

## Verification

- `yarn typecheck` / `yarn typecheck:server` / `yarn lint` / `yarn test` / `yarn build` all green.
- Grep: no residual `from "../../../server/{oldPath}"` strings in any .ts under `test/`.
- `server/` top level is exactly `{index.ts, tsconfig.json, agent/, api/, events/, system/, utils/, workspace/}`.
