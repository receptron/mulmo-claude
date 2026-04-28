# Wiki page snapshot pipeline (#763 PR 2)

GitHub: https://github.com/receptron/mulmoclaude/issues/763
Builds on:
- PR #883 (`writeWikiPage` choke point — already merged)
- #895 PR A / B (frontmatter parser + `writeWikiPage` auto-stamps `created` / `updated` / `editor`)

## Outcome

Every meaningful save through `writeWikiPage` writes a snapshot under
`data/wiki/.history/<slug>/<ISO>-<shortId>.md`. Three new routes
expose list / read / restore, gated by `hasMeaningfulChange` so
auto-stamped no-op saves don't pollute history.

## Decisions (from review on chat 2026-04-28)

| # | Topic | Decision |
|---|---|---|
| 1 | Storage | File snapshots, not git, not jsonl |
| 2 | Scope | Wiki pages only (skill / role / settings deferred) |
| 3 | Reason | Optional `reason?` carried through `WikiWriteMeta` (already in shape) |
| 4 | GC | Keep snapshots in newest 100 OR newer than 180 days; delete only when BOTH conditions are violated. No hard cap. |
| 5 | Diff UI | Line-unified for v1 (PR 3, not this PR) |
| 6 | Restore | "Restore as new edit" — past version becomes the next write, history is non-destructive |
| 7 | Size cap | None |

## Snapshot file shape

```
data/wiki/.history/<slug>/2026-04-28T01-23-45-789Z-abc12345.md
```

- File name: full ISO timestamp with `:` replaced by `-` (filesystem-safe), plus a `shortId()` to disambiguate sub-millisecond collisions.
- Content: byte-identical to **the just-written page** (i.e. the *new* state). The current page on disk == the latest snapshot. This invariant simplifies restore (just write a snapshot's content back through `writeWikiPage`).
- Frontmatter: the page's existing canonical frontmatter (title / created / updated / editor / tags / ...) **plus** the snapshot-meta fields below, prefixed `_snapshot_`. Restore strips these before writing back.

```yaml
---
title: ...
created: ...
updated: 2026-04-28T01:23:45.789Z
editor: user
_snapshot_ts: 2026-04-28T01:23:45.789Z
_snapshot_session: <chat session uuid>     # only when meta.sessionId set
_snapshot_reason: 典拠リンク追加              # only when meta.reason set
---

(body of the page as just written)
```

The `_snapshot_` prefix is chosen because:
- doesn't collide with any existing canonical key
- one underscore (not two) keeps it short while still signalling "internal" — the bar is just visual disambiguation
- `mergeFrontmatter` will strip these when restoring back to the page proper

## Implementation

### `server/workspace/wiki-pages/snapshot.ts` (new)

- `appendSnapshot(slug, oldContent, newContent, meta, opts)` — writes the snapshot file via `writeFileAtomic`, then runs GC. `oldContent` parameter is kept for symmetry with the stub signature but isn't currently used (the snapshot stores `newContent`). Could be used later for "diff snapshot" mode without breaking the call site.
- `gcSnapshots(slug, now, opts)` — readdir, parse `_snapshot_ts`, sort newest-first, retain newest 100 OR within 180 days, unlink the rest. Idempotent.
- `historyDir(slug, opts)` — path helper, mirrors `wikiPagePath`.
- `listSnapshots(slug, opts)` — list snapshot files newest-first with their meta (parsed from frontmatter).
- `readSnapshot(slug, stamp, opts)` — read a single snapshot.

### Wire `appendSnapshot` from `wiki-pages/io.ts`

The stub already exists and is called only when `hasMeaningfulChange` is true. Replace the stub body with a call into `snapshot.ts`.

### `server/api/routes/wiki/history.ts` (new)

- `GET /api/wiki/pages/:slug/history` — list snapshots (just the meta, no body)
- `GET /api/wiki/pages/:slug/history/:stamp` — read a single snapshot (full content + meta)
- `POST /api/wiki/pages/:slug/history/:stamp/restore` — read snapshot at `:stamp`, strip `_snapshot_*` keys from its frontmatter, route through `writeWikiPage(slug, content, { editor: "user", reason: "Restored from <stamp>" })`. The new save itself becomes a snapshot too.

The slug + stamp params get the same safety check as `wikiPagePath` (`isSafeSlug`) plus a stamp-shape regex so a hostile `:stamp` can't escape.

### Tests

- `test/workspace/wiki-pages/test_snapshot.ts` — unit
  - appends a snapshot file with the correct frontmatter
  - reads it back identically
  - GC keeps newest-100 OR within-180-days, deletes only the both-violated set
  - `listSnapshots` returns newest-first
  - GC doesn't touch siblings (separate slugs untouched)
  - GC tolerates malformed snapshot filenames (skips, doesn't throw)
- `test/routes/test_wikiHistoryRoute.ts` — integration via supertest
  - 3-step round trip: write → list → read → restore → list (now has new entry)
  - 404 on unknown slug / stamp
  - Path-traversal attempts rejected

## Out of scope (PR 3 / later)

- UI (History tab, unified diff, restore button) — PR 3
- LLM-vs-user editor disambiguation — separate concern, currently every save is `editor: "user"`
- Page deletion → history cleanup — no DELETE route exists today; revisit when one is added
- Word-level diff
- `manageWiki` MCP `reason` parameter — `WikiWriteMeta` already has the field; surfacing it through MCP is a UI / tool-schema change to do later

## Verification

- `yarn typecheck / lint / format / build / test` clean
- `grep -rn "appendSnapshot" server/` confirms only one impl + the call site
- new routes wired into `server/api/routes/index.ts`
