# Plan: Render LLM-written wiki pages inline in chat (Stage 3a of manageWiki removal)

Tracking: #963

## Background

Claude Code's built-in Write/Edit tools let the LLM modify wiki pages
(`data/wiki/pages/*.md`) directly, bypassing the `manageWiki` MCP tool
that historically owned wiki I/O. Today the chat history shows
nothing for these tool calls — built-in tools (Write/Edit/Read/Bash)
appear only in the right sidebar's `toolCallHistory`, which is
**not persisted** to the session JSONL.

PR #955 added a PostToolUse snapshot hook that captures the page at
the moment of every Write/Edit. Files at
`data/wiki/.history/<slug>/<filenameStamp>-<shortId>.md` carry the
full body + frontmatter as it existed at that instant.

Stage 3a:

1. The same hook → server endpoint also publishes a synthetic
   `manageWiki` toolResult (with a new `action: "page-edit"`) into
   the active chat session.
2. The toolResult is persisted in JSONL (existing `pushToolResult`
   pipeline) and broadcast to the live SSE stream, so canvas
   updates in real time AND replays correctly on reload.
3. The existing `manageWiki` plugin's `View.vue` gains a single
   new action branch (`page-edit`) that fetches the snapshot file
   by stamp and renders via the `<WikiPageBody>` extracted in
   step 1. Visual style is identical to the existing
   `action === "page"` branch because both use `<WikiPageBody>`.
4. If the snapshot has been GC'd, render falls back to reading the
   current page file via the recorded `pagePath`, with a banner
   noting the fallback.

Stage 3b (separate PR) then removes the `manageWiki` MCP tool
*definition* — but keeps the plugin/View dispatch so old JSONL
replays continue to work.

## Why one plugin, not a new one

The first sketch of this PR introduced a separate `wikiPageWrite`
plugin. We dropped that in favour of extending the existing
`manageWiki` plugin with a new `page-edit` action because:

- All wiki views (old `index`/`page`/`log`/`lint_report` AND new
  `page-edit`) share the same on-screen presentation: header chrome,
  metadata bar (where applicable), and `<WikiPageBody>`. Forcing
  visual consistency through one plugin is cheaper than coordinating
  two.
- Old session JSONL entries already use `toolName: "manageWiki"`.
  Keeping the dispatch table unchanged means replays of pre-Stage-3a
  sessions continue to work without registry alias hacks.
- The MCP tool definition (`definition.ts`) is what makes
  `manageWiki` LLM-callable. Removing it in Stage 3b strips that
  capability without breaking the canvas dispatch layer.

## Concrete data shape

`manageWiki` toolResult `data` payload published from the snapshot
endpoint:

```ts
interface PageEditWikiData {
  action: "page-edit";
  /** Wiki page slug, e.g. "design-shops". */
  slug: string;
  /** Snapshot identifier (filenameStamp + shortId), e.g.
   *  "2026-04-30T12-34-56-789Z-abc12345". Used to fetch the
   *  historical body via /api/wiki/pages/:slug/history/:stamp. */
  stamp: string;
  /** Workspace-relative path to the live wiki page, e.g.
   *  "data/wiki/pages/design-shops.md". Stored as a fallback so
   *  rendering still works after the snapshot is GC'd. */
  pagePath: string;
}
```

The full `ToolResultComplete` shape:

```ts
{
  uuid: <generated>,
  toolName: "manageWiki",
  title: <slug>,
  data: PageEditWikiData,
}
```

JSONL bytes per write: ~150 bytes — negligible.

`WikiData` (in `src/plugins/wiki/index.ts`) needs the action enum
extended to include `"page-edit"`, plus the optional `slug` /
`stamp` / `pagePath` fields.

## Implementation steps

### Step 1 — DONE
`<WikiPageBody>` extracted from `View.vue`. Commit `f6e1c2e6`.

### Step 2 — DONE
History endpoints already exist with the shape we need:
- `GET /api/wiki/pages/:slug/history` — list snapshots (meta-only)
- `GET /api/wiki/pages/:slug/history/:stamp` — read one snapshot
  (full body + meta + summary fields)

### Step 3 — server-side: emit synthetic toolResult on snapshot

File: `server/api/routes/wiki/history.ts` — `/internal/snapshot`
handler.

After `appendSnapshot(...)` succeeds, when a `sessionId` was
supplied:

```ts
if (typeof sessionId === "string" && sessionId.length > 0) {
  await pushToolResult(sessionId, {
    uuid: randomUUID(),
    toolName: "manageWiki",
    title: slug,
    data: {
      action: "page-edit",
      slug,
      stamp,
      pagePath: path.posix.join(WORKSPACE_DIRS.wikiPages, `${slug}.md`),
    },
  });
}
```

`appendSnapshot` currently returns `Promise<void>`; small change
required to return the stamp it just wrote so we can pass it
through. (Or we read it back via `listSnapshots(slug)` and pick the
newest — fine but feels wasteful. Prefer return-value tweak.)

Skipped silently when `sessionId` is absent — keeps the endpoint
usable for ad-hoc / CLI invocations without breaking on a missing
chat session.

### Step 4 — client-side: `page-edit` action branch in View.vue

File: `src/plugins/wiki/View.vue`.

1. Extend `WikiData.action` enum and add optional `slug` / `stamp`
   / `pagePath` fields (in `index.ts`).
2. Add a new state-loading path: when `data.action === "page-edit"`,
   fetch `/api/wiki/pages/:slug/history/:stamp`, populate `content`
   from the snapshot body. Reuse `useFreshPluginData` if it fits;
   otherwise a small purpose-built helper.
3. Render reuses the existing page-action template:
   - Header bar — with a "Wiki edit · {slug} · {timestamp}" subtitle
   - Metadata bar — populated from snapshot frontmatter
   - `<WikiPageBody>` — body fetched from snapshot
4. Hide chrome that doesn't apply to a moment-in-time view: PDF
   download, page tabs (Content / History), page chat composer,
   and the create/update buttons. Existing guards
   (`isStandaloneWikiRoute`, `action === "page"`) already exclude
   most; add `action === "page-edit"` to the `action !== "page"`
   exclusions where needed.

### Step 5 — render fallback chain

Inside the View's data-loading helper for `page-edit`:

```text
                   ┌─ snapshot exists ─→ render snapshot body + meta
fetch /history/:stamp ┤
                   └─ 404 ─┐
                          fetch /api/wiki?slug=X
                          ├─ 200 ─→ render current body, banner
                          │         "snapshot expired"
                          └─ 404 ─→ "page deleted" placeholder
```

Banner is a small inline notice between the metadata bar and
`<WikiPageBody>`. "page deleted" replaces the body slot entirely.

### Step 6 — i18n (8 locales)

Add to `src/lang/en.ts` then mirror into ja/zh/ko/es/pt-BR/fr/de:

```ts
pluginWiki: {
  // ...existing keys
  pageEditHeader: "Wiki edit",
  snapshotExpired: "Snapshot expired — showing current page",
  pageDeleted: "Page deleted",
}
```

### Step 7 — tests

- `test/api/test_wikiInternalSnapshotRoute.ts` (existing) — extend
  to assert `pushToolResult` is called with the expected
  `manageWiki` / `page-edit` shape when `sessionId` is supplied;
  NOT called when absent.
- `test/plugins/wiki/test_pageEdit.ts` (new) — pure helper test for
  the snapshot/fallback/deleted decision (the loader function).
  Vue render tests are flaky in node:test; keep View-level
  assertions in e2e.
- `e2e/tests/chat-wiki-write-inline.spec.ts` (new) — drive the
  internal snapshot endpoint with a sessionId, assert canvas
  shows the inline preview with the snapshot body.
- E2E regression: re-run `e2e/tests/wiki-*.spec.ts` to confirm the
  existing manageWiki UX is untouched.

### Step 8 — docs

`docs/ui-cheatsheet.md`: small note under the canvas section
mentioning `page-edit` results render the same way as
`page` results, sourced from snapshots.

## Risks and mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | SSE ordering — toolResult arrives interleaved with the next assistant text | `pushToolResult` writes JSONL synchronously before publishing; existing pipeline handles ordering. Verify by inspecting an interleaved chat transcript. |
| 2 | `sessionId` missing in hook payload | Hook payload format is set in `snapshot.ts` (the bundled hook); we already pass `sessionId` from the Claude CLI's hook env. Re-verify before commit. |
| 3 | Snapshot GC mid-session | `pagePath` fallback handles it; banner makes the situation visible. |
| 4 | Old JSONL backward compat | `page-edit` is a new action — old `index`/`page`/`log`/`lint_report` actions stay on their existing branches. No migration needed. |
| 5 | View.vue size creep | Extract data-loading and decision logic into a small helper file (`src/plugins/wiki/pageEditLoader.ts`) so the SFC doesn't balloon. |
| 6 | Async test flakiness | E2E uses `waitFor` on the rendered body; unit tests target the pure loader, not Vue. |
| 7 | Action enum collision | `page-edit` is unused elsewhere; confirm via grep. Update Zod / TS narrowing where the enum is constrained. |
| 8 | Stage 3b regression risk | This PR does NOT touch `definition.ts`. Stage 3b removes the MCP definition only; canvas dispatch / View.vue stay. |

## Definition of done
- Existing `/wiki` UI and `manageWiki` tool calls behave identically
  to before (no regression — manageWiki not touched in this PR)
- A fresh chat where the LLM writes a wiki page shows the rendered
  wiki inline in the canvas timeline, sourced from the snapshot file
- Snapshot GC'd → renders current page with banner
- Both gone → "page deleted" placeholder
- Reload of an old session replays correctly (toolResult was
  persisted in JSONL)
- All 8 locales updated
- Lint / typecheck / build / unit / e2e green
- Codex cross-review LGTM

## Test plan (for the eventual PR description)
- [ ] Unit: snapshot endpoint pushes toolResult when sessionId
      present
- [ ] Unit: snapshot endpoint skips push when sessionId absent
- [ ] Unit: `pageEditLoader` returns snapshot when found
- [ ] Unit: `pageEditLoader` returns current+banner on snapshot 404
- [ ] Unit: `pageEditLoader` returns `pageDeleted` on both 404
- [ ] E2E: LLM Write on wiki page → canvas shows inline preview
- [ ] E2E: replay older session with `manageWiki action='page'`
      result still renders correctly (regression check)
- [ ] Manual: open `/wiki` UI route — index, page view,
      lint_report, history tab all still work
