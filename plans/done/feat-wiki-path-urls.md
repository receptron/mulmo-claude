# feat: Path-based Wiki URLs

## Problem

The wiki URL schema introduced in [`feat-wiki-url-sync.md`](./done/feat-wiki-url-sync.md) uses query params:

| Current URL | Meaning |
|---|---|
| `/wiki` | Index |
| `/wiki?page=<slug>` | Page view |
| `/wiki?view=log` | Activity log |
| `/wiki?view=lint_report` | Lint report |

Three problems:

1. **Reads less canonical.** `/wiki?page=onboarding` looks like a search result; `/wiki/pages/onboarding` looks like a resource. The filesystem already stores pages at `data/wiki/pages/<slug>.md`, so a path URL mirrors the source of truth.
2. **Inconsistent with sibling plugins.** The files plugin already uses path URLs (`/files/a/b/c.md` — see [`feat-files-path-url.md`](./done/feat-files-path-url.md)). Wiki is the outlier.
3. **Query params allow accidental mixing.** Chat's `?result=<uuid>` or any future query key can bleed into a wiki URL; path URLs are immune.

## Goal

Move **all** wiki navigation dimensions from query to path:

| New URL | Meaning |
|---|---|
| `/wiki` | Index |
| `/wiki/pages/<slug>` | Page view |
| `/wiki/log` | Activity log |
| `/wiki/lint-report` | Lint report (renamed from `lint_report` for URL hygiene) |

The URL remains the single source of truth for wiki navigation (from the prior plan). Only the shape changes.

## Non-goals

- **Backwards compat.** Old `?page=` / `?view=` URLs are **not** redirected. Anyone with a stale bookmark will land on `/wiki` (index) via the router's catch-all, which is acceptable — the feature is recent and external inbound links effectively don't exist.
- Changing the internal `action` vocabulary (`index` / `page` / `log` / `lint_report`). The API still speaks `lint_report`; only the URL segment is renamed.
- Redesigning the API or tool definition.
- Subdividing pages further (e.g. `/wiki/pages/<slug>#section`).

## Design

### Route definition

Replace the single `/wiki` route at `src/router/index.ts:46` with one parameterized route:

```ts
{
  path: "/wiki/:section(pages|log|lint-report)?/:slug?",
  name: PAGE_ROUTES.wiki,
  component: Stub,
},
```

Why one route, not four:

- Every existing `route.name === PAGE_ROUTES.wiki` check across the codebase (`View.vue:184`, `View.vue:207`, `View.vue:278`, `View.vue:290`, `View.vue:307`, `View.vue:322`) keeps working unchanged.
- The `(pages|log|lint-report)` constraint makes `:section` a closed enum — `/wiki/garbage` doesn't match and falls through to the `/:pathMatch(.*)*` catch-all at `src/router/index.ts:49`, redirecting to `/chat`. That's fine.
- `:slug?` is only meaningful when `section === "pages"`. The view treats `section === "pages" && !slug` as "index" (defensive; the UI never produces that URL).

Edge case: a slug that happens to equal a section name (e.g. a user-created page literally titled "log") will never collide because the slug always sits in the *second* segment after `pages/`. `/wiki/log` is always the log view; `/wiki/pages/log` is always the page.

### URL ↔ action mapping

Internal action names stay as-is (`lint_report` with underscore); only the URL segment uses kebab-case. A tiny two-way map handles the translation:

```ts
const URL_TO_ACTION = { log: "log", "lint-report": "lint_report" } as const;
const ACTION_TO_URL = { log: "log", lint_report: "lint-report" } as const;
```

Both live inline in `View.vue` — single call site each, not worth a helper file.

### Watcher rewrite

Replace the `[route.query.page, route.query.view]` watcher at `View.vue:206-220` with a params-based watcher:

```ts
watch(
  () => (route.name === PAGE_ROUTES.wiki ? [route.params.section, route.params.slug] : null),
  (params) => {
    if (!params) return;
    const [section, slug] = params;
    if (section === "pages" && typeof slug === "string" && slug.length > 0) {
      callApi({ action: "page", pageName: slug });
    } else if (section === "log" || section === "lint-report") {
      callApi({ action: URL_TO_ACTION[section] });
    } else {
      callApi({ action: "index" });
    }
  },
  { immediate: true },
);
```

Same shape as before — just reading `params` instead of `query`.

### `pushWiki` rewrite

Replace `pushWiki` / `dropKeys` / `currentWikiQuery` at `View.vue:269-301` with a simpler params-based pusher. The `dropKeys` helper disappears entirely (query-sibling preservation is moot for path URLs — each wiki URL fully specifies its state).

```ts
type WikiTarget =
  | { kind: "index" }
  | { kind: "page"; slug: string }
  | { kind: "log" }
  | { kind: "lint_report" };

function pushWiki(target: WikiTarget) {
  const params = targetToParams(target);
  router.push({ name: PAGE_ROUTES.wiki, params }).catch((err: unknown) => {
    if (!isNavigationFailure(err)) console.error("[wiki] navigation failed:", err);
  });
}

function targetToParams(target: WikiTarget): Record<string, string> {
  switch (target.kind) {
    case "index":       return {};
    case "page":        return { section: "pages", slug: target.slug };
    case "log":         return { section: "log" };
    case "lint_report": return { section: "lint-report" };
  }
}

function navigate(newAction: "index" | WikiTabView) {
  pushWiki(newAction === "index" ? { kind: "index" } : { kind: newAction });
}

function navigatePage(pageName: string) {
  pushWiki({ kind: "page", slug: pageName });
}
```

Note: `router.push({ name, params })` works identically whether we're already on `/wiki` or coming from `/chat` — Vue Router resolves the name and builds the path. The special-case branch in the old `pushWiki` (`route.name === PAGE_ROUTES.wiki ? { query } : { name, query }`) is no longer needed.

### `currentSlug()` update

`View.vue:318-325` reads the slug from the URL to drive the per-page chat composer. Update it to read from `route.params`:

```ts
function currentSlug(): string | null {
  const raw =
    route.name === PAGE_ROUTES.wiki && route.params.section === "pages" && typeof route.params.slug === "string"
      ? route.params.slug
      : (props.selectedResult?.data?.pageName ?? null);
  if (!raw || !isSafeSlug(raw)) return null;
  return raw;
}
```

`isSafeSlug` (rejecting `/`, `\`, `..`) stays unchanged — still defense-in-depth, even though the router's `:slug?` segment can't contain `/` in the first place.

### Non-ASCII slugs

Vue Router percent-encodes path params on `push` and decodes them on read, so `route.params.slug` always comes back as the original string. Japanese slugs like `さくらインターネット` round-trip correctly. Worth a one-line E2E assertion to lock this in.

### App.vue call site

`App.vue:776` currently does:

```ts
router.push({ name: PAGE_ROUTES.wiki, query: { page: target.slug } }).catch(() => {});
```

Change to:

```ts
router.push({ name: PAGE_ROUTES.wiki, params: { section: "pages", slug: target.slug } }).catch(() => {});
```

This is the only wiki-URL-building site outside `View.vue`.

## Implementation steps

1. **Router.** Update the wiki route at `src/router/index.ts:46` to the parameterized path. No new `PAGE_ROUTES` entries — name stays `wiki`.
2. **View.vue — watcher.** Swap `route.query.page` / `route.query.view` for `route.params.section` / `route.params.slug` in the watcher at line 206-220. Introduce the `URL_TO_ACTION` map.
3. **View.vue — pushers.** Replace `pushWiki` / `dropKeys` / `currentWikiQuery` (lines 269-301) with the `WikiTarget`-based version. Delete `dropKeys` and `currentWikiQuery` — they're dead.
4. **View.vue — `currentSlug()`.** Rewrite at line 318-325 to read `route.params`.
5. **App.vue.** Update the wiki push at line 776 to use `params`.
6. **E2E tests.** Update URLs in:
   - `e2e/tests/wiki-navigation.spec.ts` — module docstring (lines 5-15) and every `page.goto` / `waitForURL` using the old schema (lines 97-180).
   - `e2e/tests/wiki-page-chat.spec.ts` — `page.goto` calls at lines 85, 91, 105, 112, 137.
   - Add one assertion that a non-ASCII slug round-trips through the URL without mangling.
7. **Run checks.** `yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`, `yarn test:e2e`.

## Test plan

### E2E

All existing `wiki-navigation.spec.ts` cases, retargeted at new URLs:

- Click a page card → URL becomes `/wiki/pages/<slug>`.
- Click **Log** tab → URL becomes `/wiki/log`.
- Click **Lint** tab → URL becomes `/wiki/lint-report`.
- Click **Index** tab from any sub-view → URL becomes `/wiki` (no trailing segments).
- Click an in-content `[[wiki-link]]` → URL updates to `/wiki/pages/<target>`.
- Browser back from a page view returns to index with URL `/wiki`.
- Direct visit to `/wiki/pages/<slug>` loads that page without an "index → page" flicker.
- Direct visit to `/wiki/log` loads log content, not index.
- **Tool-result context:** wiki index as a `manageWiki` tool result on `/chat/:sessionId`, click a page card → URL is now `/wiki/pages/<slug>`, full `/wiki` view rendered.
- **Path traversal guard:** `/wiki/pages/..%2Fsecrets` (or the router's resolution of it) does not produce an attacker-controlled slug in the prompt — `isSafeSlug` still rejects.
- **Non-ASCII:** `/wiki/pages/さくらインターネット` loads the page; `route.params.slug` decodes to the original string.

### Unit

None — logic lives in the Vue component and is covered by E2E.

### Manual

- Reload on `/wiki/pages/foo` — selection persists.
- Copy URL, open in new tab — same page loads.
- Back/forward through `index → pages/A → pages/B → log` — each step restores expected state.
- Old stale URL `/wiki?page=foo` — confirm it lands on the index (not a crash); no redirect is intentional.

## Review-pass addendum (post-PR #655 review by isamu)

The initial landing kept param reading / building / validation inline in
`View.vue`, with `App.vue` copying the literal `{ section: "pages", slug }`
shape. The review (PR #655 comment) pointed out that this mirrored the
drift-prone pattern `#633` had already solved for files, and left a
security gap in the watcher where `/wiki/pages/..%2Fsecrets` decodes to
`slug === "../secrets"` and reached the server's fuzzy matcher with no
guard. Addressed as follows:

1. **New helper** `src/plugins/wiki/route.ts` owns all wiki URL / action
   literals plus three pure functions:
   - `readWikiRouteTarget(params)` — normalise `route.params` to a
     `WikiTarget | null`, returning `null` for unsafe slugs or unknown
     sections.
   - `buildWikiRouteParams(target)` — inverse; produces the object
     `router.push({ name, params })` expects.
   - `isSafeWikiSlug(value)` — separators and `..` rejection.
2. **Router guard** (`src/router/guards.ts`) runs `readWikiRouteTarget`
   at navigation time and redirects to `/wiki` with `replace: true`
   when it returns `null`. Single source of truth for "is this URL
   legitimate" — same guard catches direct navigation, pasted links,
   and programmatic pushes.
3. **View.vue / App.vue** import from the helper instead of duplicating
   the string literals / target-to-params map.
4. **Unit tests** (`test/plugins/wiki/test_route.ts`) cover the helper
   exhaustively, including round-trip `buildWikiRouteParams` →
   `readWikiRouteTarget`.
5. **E2E tables** in `wiki-navigation.spec.ts`:
   - `SAFE_SLUGS` — space, `%`, `#`, `?`, `+`, `&`, parens, Japanese,
     Korean, emoji — each navigates to `/wiki/pages/<encoded>` and
     asserts the sentinel body rendered (proving the decoded slug
     reached the server unmangled).
   - `DANGEROUS_URLS` — `%2F` in slug, `..%2Fsecrets`, bare `..`,
     backslash, `/wiki/pages` with no slug — each must redirect to
     `/wiki` and must NOT trigger a page fetch.
6. **wiki-page-chat.spec.ts**: the old "send button disabled" test for
   a traversal URL became "guard redirects to `/wiki` — composer
   doesn't exist at all", a strictly stronger assertion.

## Out of scope / future work

- Redirecting old `?page=` / `?view=` URLs to the new paths. Explicitly declined per non-goals.
- A shared `router-path-builder` composable when a third plugin adopts path URLs (two — files, wiki — still doesn't justify it).
- Deep-linking into a section within a page (`/wiki/pages/foo#section-2`).
- Encoding the scroll offset or composer draft in the URL.
