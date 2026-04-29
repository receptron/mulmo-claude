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
   `wikiPageWrite` toolResult into the active chat session.
2. The toolResult is persisted in JSONL (existing `pushToolResult`
   pipeline) and broadcast to the live SSE stream, so canvas updates
   in real time AND replays correctly on reload.
3. A new `wikiPageWrite` plugin (View component only — not an MCP
   tool) receives the toolResult, fetches the snapshot file by stamp,
   and renders via the `<WikiPageBody>` extracted in step 1.
4. If the snapshot has been GC'd, render falls back to reading the
   current page file via the recorded `pagePath`, with a banner
   noting the fallback.

Stage 3b (separate PR) then removes the `manageWiki` MCP tool.

## Scope

### In scope (this PR)
1. **Already done — step 1**: Pure `<WikiPageBody>` extracted from
   `View.vue`. Commit `f6e1c2e6`.
2. **Already verified — step 2**: history endpoints
   `GET /api/wiki/pages/:slug/history` (list) +
   `/:stamp` (single) exist with the shape we need.
3. **Server side — emit synthetic toolResult on snapshot**: extend
   `POST /api/wiki/internal/snapshot` (in
   `server/api/routes/wiki/history.ts`) so that after `appendSnapshot`
   completes, it also calls `pushToolResult(sessionId, ...)` with a
   `wikiPageWrite` toolResult. Skipped silently when no `sessionId`
   was supplied (e.g. ad-hoc CLI invocation, no chat to update).
4. **Client side — register plugin + render**: new
   `src/plugins/wikiPageWrite/` directory with `index.ts` (plugin
   record), `View.vue`, optional `Preview.vue`. Registered in
   `src/tools/index.ts`. Not MCP-callable (no `definition.ts`).
5. **Render flow**: View receives `{slug, stamp, pagePath}`. Tries
   snapshot lookup; on 404 (snapshot GC'd) falls back to reading
   the current page; on both-fail shows "page deleted".
6. **i18n**: new strings ("snapshot expired", "page deleted")
   added to all 8 locales.
7. **Tests**: route test for the snapshot-emits-toolResult path, unit
   test for the View's three render branches (snapshot / fallback /
   missing), e2e for "LLM Writes wiki page → canvas timeline shows
   inline preview".

### Out of scope (future)
- **Read tool**: PostToolUse on Read could surface "LLM read this
  page" inline, but Read doesn't take a snapshot, so the data path
  differs. Defer to a follow-up.
- **Removing `manageWiki`** — Stage 3b.
- **Updating role prompts** — Stage 3b.
- **Help docs cleanup** — Stage 3b.

## Concrete data shape

ToolResult `data` payload published from the snapshot endpoint:

```ts
interface WikiPageWriteData {
  /** Wiki page slug, e.g. "design-shops". */
  slug: string;
  /** Snapshot identifier (filenameStamp + shortId), e.g.
   *  "2026-04-29T12-34-56-789Z-abc12345". Used to fetch the
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
  toolName: "wikiPageWrite",
  title: <slug>,
  data: WikiPageWriteData,
}
```

JSONL bytes per write: ~150 bytes — negligible.

## Implementation steps

### Step 3 — server emits synthetic toolResult

File: `server/api/routes/wiki/history.ts`

After `appendSnapshot(...)` succeeds in the
`/internal/snapshot` handler:

```ts
if (typeof sessionId === "string" && sessionId.length > 0) {
  const stamp = /* return value or last-listed stamp from appendSnapshot */;
  await pushToolResult(sessionId, {
    uuid: randomUUID(),
    toolName: "wikiPageWrite",
    title: slug,
    data: {
      slug,
      stamp,
      pagePath: path.posix.join(WORKSPACE_DIRS.wikiPages, `${slug}.md`),
    },
  });
}
```

`appendSnapshot` may need a small tweak: it currently returns
`Promise<void>`; we need it to return the stamp it just wrote so we
can pass it through. Check the existing return shape — if it's
already there or trivial to add, fold into this step.

Skipped when `sessionId` is absent — keeps the endpoint usable for
ad-hoc / CLI invocations without breaking on a missing chat session.

### Step 4 — client plugin

New directory `src/plugins/wikiPageWrite/`:

- `index.ts` — exports the plugin record (no `definition` field —
  not LLM-callable). Register in `src/tools/index.ts` next to
  `manageWiki`.
- `View.vue` — receives `selectedResult: ToolResultComplete<WikiPageWriteData>`.
  Workflow:
    1. On mount / when `result.uuid` changes, fetch
       `GET /api/wiki/pages/:slug/history/:stamp` via `apiGet`
    2. On 200: render `<WikiPageBody body={snapshot.body} baseDir="data/wiki/pages">`.
       Show meta bar from `snapshot.meta` (created/updated/editor/tags).
       Header line: "Wiki edit · {slug}" + timestamp from
       `snapshot.ts`.
    3. On 404: fall back to `apiGet("/api/wiki?slug=" + slug)`.
       Show a small banner: "Snapshot expired — showing current
       page" (i18n key: `pluginWikiPageWrite.snapshotExpired`).
    4. On both 404: render "Page deleted" placeholder.
- `Preview.vue` — minimal placeholder; the canvas render is the
  primary view.

### Step 5 — i18n

Add to `src/lang/en.ts` (then mirror into the other 7 locales):

```ts
pluginWikiPageWrite: {
  header: "Wiki edit",
  snapshotExpired: "Snapshot expired — showing current page",
  pageDeleted: "Page deleted",
}
```

### Step 6 — tests

- `test/api/test_wikiInternalSnapshotRoute.ts` (existing) — extend
  to assert `pushToolResult` is called when `sessionId` is supplied,
  with the expected shape; NOT called when `sessionId` is absent.
- `test/plugins/wikiPageWrite/test_view.ts` — three render branches
  (snapshot present / 404 → fallback / both 404 → page deleted).
- `e2e/tests/chat-wiki-write-inline.spec.ts` — mock LLM Write on a
  wiki page (via the snapshot endpoint), assert the canvas shows
  the inline preview with the snapshot body.

### Step 7 — docs

- `docs/ui-cheatsheet.md`: small update if a new chat surface
  region warrants. Likely adds a `[wikiPageWrite]` entry under
  the canvas section.

## Render fallback flow

```
                   ┌─ snapshot exists ─→ render snapshot body + meta
fetch /history/:stamp ┤
                   └─ 404 ─┐
                          fetch /api/wiki?slug=X
                          ├─ 200 ─→ render current body, banner: "snapshot expired"
                          └─ 404 ─→ "page deleted" placeholder
```

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

## Test plan (for the PR description)
- [ ] Unit: snapshot endpoint pushes toolResult when sessionId
      present
- [ ] Unit: snapshot endpoint skips push when sessionId absent
- [ ] Unit: View renders snapshot body when snapshot found
- [ ] Unit: View falls back to current page on snapshot 404
- [ ] Unit: View shows "page deleted" placeholder on both 404
- [ ] E2E: LLM Write on wiki page → canvas shows inline preview
- [ ] E2E: replay older session with `manageWiki action='page'`
      result still renders correctly (regression check)
- [ ] Manual: open `/wiki` UI route — index, page view,
      lint_report, history tab all still work
