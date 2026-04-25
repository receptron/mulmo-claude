# Wiki page task-checkbox toggle (#775, completion)

## Goal

Same UX as the markdown plugin half merged in PR #778: clicking a
GFM `- [ ]` / `- [x]` checkbox in a wiki page viewer toggles the
source line and persists the new content to disk. Closes #775.

## Non-goals

- LLM-facing `manageWiki` MCP tool extension. The save path is
  HTTP-only, used by the wiki page View. The agent already has
  `Write` for direct file edits.
- Any `manageWiki save` agent command. If the agent needs to flip a
  checkbox programmatically it can use `Read` + `Write` like before.
- Other wiki edits (rename, delete, frontmatter mutation). Just
  the in-place body content overwrite needed for checkbox toggle.

## Server side — `POST /api/wiki { action: "save" }`

Extend the existing wiki POST handler:

```ts
// Body
{ action: "save", pageName: string, content: string }
```

- `pageName` is the same form already accepted by `action: "page"`
  (slug or title; resolved via `resolvePagePath`).
- `content` is the full new file contents — frontmatter included.
  Client is responsible for preserving frontmatter; server doesn't
  reach into the body.
- If `resolvePagePath(pageName)` returns null, reject with
  "Page not found" — we're toggling an existing page, not creating
  one. (Fresh page creation belongs to a different flow.)
- Write via `writeFileAtomic` so a crashed partial write can't
  truncate a real wiki page.
- Log info on success / warn on missing pageName / warn on
  not-found, mirroring the pattern used by the existing actions.

The handler stays in the same `switch (action)` block so all
existing routes / clients are untouched.

## Client side — `wiki/View.vue`

Mirror the markdown plugin's pattern (PR #778):

1. Import `findTaskLines`, `toggleTaskAt`, `makeTasksInteractive`
   from `src/utils/markdown/taskList.ts`.
2. Apply `makeTasksInteractive` to the marked-rendered HTML in
   `renderedContent` so checkboxes lose `disabled=""` and gain
   `class="md-task"`.
3. Extend the existing `handleContentClick` delegation: if the
   click target is an `input.md-task`, route to a new
   `onTaskCheckboxClick`. Other branches (wiki-link, external link,
   workspace-internal link) stay as-is.
4. `onTaskCheckboxClick`:
   - Bail when `action.value !== "page"` — only page bodies are
     toggleable; index / log / lint_report views never carry user
     content to write back.
   - **Frontmatter handling** — `content.value` may include a YAML
     frontmatter block. The renderer strips it before marked sees
     the body, so the DOM checkbox count is body-only. The source
     walker would otherwise also count any `- [ ]`-shaped lines
     inside frontmatter (e.g. `tags: [- [ ] x]` inline arrays),
     causing a count mismatch and a refused click. Solution: split
     the content via `extractFrontmatter`, run the walker on the
     body, reassemble verbatim using the original prefix length so
     the frontmatter delimiters are preserved exactly.
   - Cross-check `findTaskLines(body).length` against the rendered
     DOM's `input.md-task` count, same defence as the markdown
     plugin.
   - Optimistic local update: `content.value = newContent`. The
     existing watch on `content` re-renders.
   - Persist via `apiPost(API_ROUTES.wiki.base, { action: "save",
     pageName, content: newContent })`. On failure, surface via the
     existing `navError` ref and refetch via `refresh()` to sync
     local state with disk.

`pageName` for the POST: use the slug already in the route (via
`props.selectedResult?.data?.pageName` or the URL param), the same
value the page-load fetcher passes.

Same disabled-while-editing rule does NOT apply here — wiki has no
in-place source editor (yet). When that lands the cross-check can
be added.

## Tests

- New server-side test for the `save` route handler:
  - happy path (existing page → content overwritten)
  - missing pageName → 400
  - missing content → 400
  - page not found → 404
  - traversal-shaped pageName → handled by `resolvePagePath` /
    slugify (already validated; just spot-check it doesn't write
    outside `data/wiki/pages/`)
- Pure-helper coverage for the toggle math is already in
  `test/utils/markdown/test_taskList.ts` from #778; no need to
  duplicate.

## Manual test plan

1. Open a wiki page with at least one `- [ ]` task
2. Click → checkbox flips; `cat ~/mulmoclaude/data/wiki/pages/<slug>.md`
   shows the source updated to `- [x]`
3. Click again → reverts
4. Quoted task (`> - [ ]`) toggles correctly
5. Page with frontmatter still toggles cleanly (frontmatter intact)
6. Page with task-shaped content inside frontmatter → click
   refused with the same error message the markdown plugin shows

## Out of scope (future)

- Wiki source editor with task-aware disable (the markdown plugin's
  `<details>` approach)
- Real-time sync if multiple clients view the same page
