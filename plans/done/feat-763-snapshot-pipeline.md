# Wiki page snapshot pipeline (#763 PR 2)

GitHub: https://github.com/receptron/mulmoclaude/issues/763
Builds on:
- PR #883 (`writeWikiPage` choke point — already merged)
- #895 PR A / B (frontmatter parser + `writeWikiPage` auto-stamps `created` / `updated` / `editor`)

## Outcome

Every meaningful save through `writeWikiPage` AND every LLM-driven
`Write` / `Edit` to `data/wiki/pages/<slug>.md` deposits a snapshot
under `data/wiki/.history/<slug>/<filenameStamp>-<shortId>.md`.
Three public routes expose list / read / restore.

The LLM path is what makes this useful — claude CLI's built-in
Write / Edit tools bypass `writeWikiPage`, so an in-process choke
point alone catches almost nothing. We close that gap with a
PostToolUse hook (`<workspace>/.claude/hooks/wiki-snapshot.mjs`)
that calls back into `POST /api/wiki/internal/snapshot` whenever
the LLM touches a wiki page. The hook script + `.claude/settings.json`
entry are provisioned at server startup, idempotent, and never
touch `~/.claude` (the user's global config).

## Decisions (from review on chat 2026-04-28)

| # | Topic | Decision |
|---|---|---|
| 1 | Storage | File snapshots, not git, not jsonl |
| 2 | Scope | Wiki pages only (skill / role / settings deferred) |
| 3 | Reason | Optional `reason?` carried through `WikiWriteMeta` |
| 4 | GC | Keep newest 100 OR newer than 180 days; delete only when BOTH violated. No hard cap. |
| 5 | Diff UI | Line-unified for v1 (PR 3, not this PR) |
| 6 | Restore | "Restore as new edit" — past version becomes the next write, history is non-destructive |
| 7 | Size cap | None |

Codex iter-1 (during chat review) added two more:

| # | Topic | Decision |
|---|---|---|
| 8 | Same-millisecond stamp collisions | Public `stamp` is `<filenameStamp>-<shortId>`, not just the time part. Two same-ms writes are addressable independently. |
| 9 | Restore-to-current-content no-op | `WikiWriteMeta.forceSnapshot` bypasses the `hasMeaningfulChange` gate so a restore always lands an audit entry. |

## Snapshot file shape

```
data/wiki/.history/<slug>/2026-04-28T01-23-45-789Z-abc12345.md
```

- File name: ISO timestamp with `:` replaced by `-` (filesystem-safe), plus a `shortId()` to disambiguate sub-millisecond collisions.
- Content: byte-identical to **the just-written page** (i.e. the *new* state). The current page on disk == the latest snapshot. Restore writes the snapshot's body back through `writeWikiPage` (with `forceSnapshot: true`).
- Frontmatter: the page's existing canonical frontmatter **plus** the snapshot-meta fields below, prefixed `_snapshot_`. Restore strips these before writing back.

```yaml
---
title: ...
created: ...
updated: 2026-04-28T01:23:45.789Z
editor: user                                # or "llm" for hook-driven captures
_snapshot_ts: 2026-04-28T01:23:45.789Z
_snapshot_session: <chat session uuid>     # only when meta.sessionId set
_snapshot_reason: 典拠リンク追加              # only when meta.reason set
---

(body of the page as just written)
```

## Implementation

### `server/workspace/wiki-pages/snapshot.ts` (new)

- `appendSnapshot(slug, oldContent, newContent, meta, opts)` — writes the snapshot file via `writeFileAtomic`, then runs GC.
- `gcSnapshots(slug, now, opts)` — readdir, sort newest-first, retain by OR-rule, unlink the rest. Idempotent.
- `historyDir`, `listSnapshots`, `readSnapshot`, `isSafeStamp`, `stripSnapshotMeta` — helpers.

### `server/workspace/wiki-pages/io.ts` (modified)

- Imports `appendSnapshot` from `snapshot.ts`.
- `WikiWriteMeta.forceSnapshot?: boolean` — bypass the `hasMeaningfulChange` gate; restore uses this so an "identical content restore" still lands an audit entry.
- Threads `workspaceRoot` + `now` into `appendSnapshot` so tests can inject deterministic clocks.

### `server/api/routes/wiki/history.ts` (new)

- `GET /api/wiki/pages/:slug/history` — list snapshots (meta, no body)
- `GET /api/wiki/pages/:slug/history/:stamp` — read one (full content + meta)
- `POST /api/wiki/pages/:slug/history/:stamp/restore` — round-trip the snapshot through `writeWikiPage` with `editor: "user"`, `reason: "Restored from <stamp>"`, `forceSnapshot: true`.
- `POST /api/wiki/internal/snapshot` — internal endpoint hit by the LLM-write hook. Validates `absPath` lives under `data/wiki/pages/`, reads disk, calls `appendSnapshot` with `editor: "llm"`. Bearer auth applies via the global middleware.

### `server/workspace/wiki-history/{hookScript.ts, provision.ts}` (new)

- `hookScript.ts` exports `WIKI_SNAPSHOT_HOOK_SCRIPT` — the Node ESM source code that gets written to `<workspace>/.claude/hooks/wiki-snapshot.mjs` at provisioning time. Reads stdin JSON from claude CLI, path-filters for `data/wiki/pages/`, POSTs to the internal endpoint with bearer from `<workspace>/.session-token` and port from `<workspace>/.server-port`.
- `provision.ts` exports `provisionWikiHistoryHook(opts)` — idempotent: writes the script and merges a PostToolUse entry into `<workspace>/.claude/settings.json`. Tagged `mulmoclaudeWikiHistory: true` so we can find and update our own entry without clobbering user-set hooks.

### `server/index.ts` (modified)

- `provisionWikiHistoryHook()` runs after `initWorkspace()` so the hook is in place before any agent spawn.
- `app.listen` callback writes `<workspace>/.server-port` (mode 0600) so the hook script can address the actually-bound port.

## Tests

- `test/workspace/wiki-pages/test_snapshot.ts` — appendSnapshot round-trip, GC OR-rule edge cases, isolation across slugs, stray-file tolerance, `isSafeStamp` shape (full `<stamp>-<id>` pattern), `stripSnapshotMeta`, integration via `writeWikiPage`.
- `test/routes/test_wikiHistoryRoute.ts` — list / read / restore happy paths, 4xx for unsafe slug + unsafe stamp, 404 for unknown slug + unknown stamp, `_snapshot_*` doesn't leak into the live page on restore.
- `test/routes/test_wikiInternalSnapshotRoute.ts` — 400 on missing / non-wiki / traversal absPath, 404 when file missing, snapshot tagged `editor: "llm"`, sessionId propagation.
- `test/workspace/wiki-history/test_provision.ts` — first install creates settings + script, idempotent on re-run, preserves user-set keys, replaces stale owned entry instead of duplicating.

## Out of scope (PR 3 / later)

- UI (History tab, unified diff, restore button) — PR 3
- Page deletion → history cleanup — no DELETE route exists today; revisit when one is added
- Word-level diff
- `manageWiki` MCP `reason` parameter — `WikiWriteMeta` already has the field; surfacing it through MCP is a tool-schema change

## Verification

- `yarn typecheck / lint / format / build / test` clean
- `grep -rn "appendSnapshot" server/` shows only the impl + call sites
- New routes wired in `server/index.ts`
- New file constants added to `WORKSPACE_DIRS.wikiHistory`, `WORKSPACE_FILES.serverPort`, `API_ROUTES.wiki.{pageHistory,pageHistorySnapshot,pageHistoryRestore,internalSnapshot}`
