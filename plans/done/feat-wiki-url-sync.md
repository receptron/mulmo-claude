# feat: Sync Wiki navigation with the URL

## Problem

The Wiki already *reads* `?page=<slug>` from the URL (`src/plugins/wiki/View.vue:146-154`) and external wiki-link clicks already push it (`src/App.vue:757`), but **in-view** navigation does not update the URL:

| Interaction | Location | Current behavior |
|---|---|---|
| Click a page card in the index list | `View.vue:70` → `navigatePage()` | Calls `callApi()` only; URL stays `/wiki` |
| Click a `[[wiki-link]]` inside rendered markdown | `View.vue:250` → `navigatePage()` | Same — URL unchanged |
| Click the **Index** / **Log** / **Lint** tab buttons | `View.vue:30/37/44` → `navigate()` | Same — URL unchanged |
| Click **← back to Index** | `View.vue:6` → `navigate('index')` | Same — `?page=` stays in URL |

Consequences:

1. Reloading the page or copying the URL loses the current selection.
2. Browser back/forward doesn't traverse wiki history.
3. Most importantly: when the Wiki index is displayed **as the result of a `manageWiki` tool call** (i.e. `WikiView` mounted at `App.vue:105-110` inside the chat-page single layout), clicking a page card silently mutates local state without any URL change — there is no breadcrumb that the user navigated anywhere, and no way to deep-link back to what they saw.

## Goal

Make the URL the single source of truth for wiki navigation, following the same pattern `useFileSelection` uses for `/files?path=...`. Every in-view navigation — tab switch, index card click, wiki-link click, back button — should go through `router.push(...)` and let a single watcher drive the API call that refreshes state.

Must work in **both** mount contexts of `WikiView`:

- `App.vue:131` — standalone `/wiki` page.
- `App.vue:105-110` — as the `manageWiki` tool-result viewer on `/chat/:sessionId`.

## Non-goals

- Redesigning the wiki API or tool definition.
- Persisting the last-seen wiki page across sessions (URL sharing already gives that).
- Changing how `[[wiki-link]]` rewriting works in markdown pre-processing.

## Design

### URL schema

Extend what is already read today. One query param per dimension:

| Param | Values | Meaning |
|---|---|---|
| `page` | any wiki slug | Show that page. Takes precedence over `view`. |
| `view` | `log` \| `lint_report` | Show the corresponding action view. Absent = index. |

Examples:

- `/wiki` → index
- `/wiki?page=anthropic` → page view for slug `anthropic`
- `/wiki?view=log` → activity log
- `/wiki?view=lint_report` → lint report

No param = index. `page` wins over `view` if both are set (defensive; shouldn't happen in practice).

### Single source of truth

Today `navigate()` and `navigatePage()` both call `callApi()` directly. After this change, they push to the router and a single watcher drives `callApi()`:

```ts
// Replaces the existing route.query.page watcher.
watch(
  () => [route.query.page, route.query.view] as const,
  ([page, view]) => {
    if (typeof page === "string" && page.length > 0) {
      callApi({ action: "page", pageName: page });
    } else if (view === "log" || view === "lint_report") {
      callApi({ action: view });
    } else {
      callApi({ action: "index" });
    }
  },
  { immediate: true },
);
```

`navigate()` / `navigatePage()` become pure URL-pushers:

```ts
function navigate(newAction: "index" | "log" | "lint_report") {
  const query =
    newAction === "index" ? dropKeys(route.query, ["page", "view"])
    : { ...dropKeys(route.query, ["page"]), view: newAction };
  pushWiki(query);
}

function navigatePage(pageName: string) {
  pushWiki({ ...dropKeys(route.query, ["view"]), page: pageName });
}
```

`pushWiki(query)` is the cross-context helper described next.

### Cross-context navigation

`WikiView` is mounted in two places, so `router.push` must behave differently:

- On `/wiki` → update query params, stay on `/wiki`.
- On `/chat/:sessionId` (tool-result viewer) → navigate to `/wiki` with the requested query. This moves the user from the chat single-layout into the dedicated wiki page, matching the existing behavior in `App.vue:749-758` for wiki-link clicks inside text responses.

```ts
function pushWiki(query: LocationQuery) {
  const target = route.name === PAGE_ROUTES.wiki
    ? { query }
    : { name: PAGE_ROUTES.wiki, query };
  router.push(target).catch(() => {});
}
```

This keeps the tool-result variant's behavior consistent with App.vue's existing wiki-link handler and means: **clicking a page card in an index rendered as a tool result takes the user to `/wiki?page=<slug>`**, with a proper history entry and shareable URL.

### Relationship to `props.selectedResult` and `useFreshPluginData`

Currently three sources mutate the local `action`/`content` state:

1. `callApi()` — from button clicks.
2. The `props.selectedResult.uuid` watcher — when a new tool result is selected.
3. `useFreshPluginData` — periodic refresh keyed off the current slug.

After this change:

- `callApi()` is only ever invoked by the route watcher. Button handlers push the URL and do nothing else.
- The `props.selectedResult.uuid` watcher is **kept as-is** (it seeds initial state from the tool result payload when the view first mounts inside a chat page — we don't want to immediately refetch when the tool already returned the data).
- `useFreshPluginData` is kept. Its endpoint function already keys off the current `action`/`pageName`, which are still updated by `callApi()`, so the behavior is unchanged.

Edge case: when the tool result arrives (`selectedResult.uuid` changes) while the URL also has `?page=` set, both watchers will try to set state. Order the logic so the route watcher runs second and wins (trivial — Vue runs watchers in the order they're declared; keep the route watcher last). In practice they'll produce the same state, so this is belt-and-suspenders.

## Implementation steps

All changes are in `src/plugins/wiki/View.vue` unless noted.

1. **Add router imports and helper.** Import `useRouter`, `PAGE_ROUTES`, and a small `dropKeys(obj, keys)` helper (inline — not worth a utility file for one call site).
2. **Replace the two handlers.** Rewrite `navigate()` (line 201) and `navigatePage()` (line 205) to push router state via `pushWiki()` instead of calling `callApi()`.
3. **Introduce a single route-driven watcher.** Replace the existing `route.query.page` watcher (line 146-154) with the combined `[page, view]` watcher shown in the Design section. Use `immediate: true` so mounting with `?page=foo` or `?view=log` already in the URL triggers the right fetch.
4. **Keep `callApi()` private to the watcher.** No signature change, but no other code path should call it.
5. **Audit `handleContentClick()`** (line 243). It already calls `navigatePage(link.dataset.page)` for `[[wiki-link]]` clicks — no change needed once `navigatePage()` switches to pushing the URL.
6. **Remove the now-redundant `App.vue:756-758` handler?** No. Keep it — that path handles wiki links rendered in *text responses* (outside `WikiView`), which need to navigate into `/wiki` regardless. The logic is identical to `pushWiki()`, but consolidating would require moving it into a shared composable for marginal benefit; out of scope.

## Test plan

### E2E (Playwright — add to `e2e/tests/wiki-plugin.spec.ts`)

- Click a page card in the index → URL becomes `/wiki?page=<slug>` and the page content renders.
- Click the **Log** tab → URL becomes `/wiki?view=log`.
- Click **Index** tab from a page → URL becomes `/wiki` (no query).
- Click an in-content `[[wiki-link]]` → URL updates to `/wiki?page=<target>`.
- Browser back button from a page view returns to the index with URL `/wiki`.
- Direct visit to `/wiki?page=<slug>` loads that page without a visible "index → page" flicker.
- **Tool-result context**: mount the wiki index as a `manageWiki` tool result on `/chat/:sessionId`, click a page card, assert the URL is now `/wiki?page=<slug>` and the full `/wiki` view is rendered.

### Unit

No new unit tests — the logic lives entirely in the Vue component and is covered by E2E.

### Manual

- Reload the page while on `/wiki?page=foo` — selection persists.
- Copy URL, open in new tab — same page loads.
- Use back/forward to traverse `index → page A → page B → log` — each step restores the expected state.

## Out of scope / future work

- Lifting the `pushWiki` logic into a shared composable when a third mount context appears. Two call sites (View + App.vue:756) isn't enough to justify it yet.
- Encoding position within a page (scroll offset, section anchor) in the URL.
- Browser title updates as the slug changes.
