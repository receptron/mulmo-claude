// Pure helpers for reading, building, and validating wiki route
// params. Kept free of Vue / vue-router imports so it can be used
// from:
//
//  - `src/router/guards.ts` (synchronous validation at navigation time)
//  - `src/plugins/wiki/View.vue` (watcher + push helpers)
//  - `src/App.vue` (workspace-link click handler)
//  - unit tests
//
// Mirrors the pattern established by `src/composables/useFileSelection.ts`
// (#633): one file owns the URL ↔ domain mapping, so the literals don't
// drift across the router definition, guards, views, and tests.

// URL segment used in `/wiki/:section/...`. Closed enum — the router
// regex `(pages|log|lint-report)` rejects anything else.
export const WIKI_ROUTE_SECTION = {
  pages: "pages",
  log: "log",
  lintReport: "lint-report",
} as const;

export type WikiRouteSection = (typeof WIKI_ROUTE_SECTION)[keyof typeof WIKI_ROUTE_SECTION];

// Internal action name sent to the server / shown in the View. Diverges
// from the URL segment in one place only: `lint-report` (URL) vs
// `lint_report` (action), because the server API still speaks the
// underscore form.
export const WIKI_ACTION = {
  index: "index",
  page: "page",
  log: "log",
  lintReport: "lint_report",
} as const;

export type WikiAction = (typeof WIKI_ACTION)[keyof typeof WIKI_ACTION];

// Route-level representation. `pushWiki(target)` and
// `readWikiRouteTarget(params)` both speak this so the watcher, the
// button handlers, and the router guard agree on the same shape.
export type WikiTarget = { kind: "index" } | { kind: "page"; slug: string } | { kind: "log" } | { kind: "lint_report" };

// Reject anything that could escape `data/wiki/pages/` or collide
// with a different page. Vue Router decodes `%2F` back to `/` in
// `route.params.slug`, so `/wiki/pages/..%2Fsecrets` lands here as
// `slug === "../secrets"` — this check is the last line of defence
// before the slug is passed to the server's page resolver
// (`wikiSlugify` strips `..` but would still match a page literally
// named `secrets` via its fuzzy fallback). Non-ASCII characters
// (e.g. Japanese page titles) are allowed; only separators and `..`
// are blocked.
export function isSafeWikiSlug(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  if (value.includes("/")) return false;
  if (value.includes("\\")) return false;
  if (value.includes("..")) return false;
  return true;
}

// Read `route.params` from the wiki route and normalise to a
// `WikiTarget`. Returns `null` when the params describe an invalid
// state (unknown section, missing slug for a page view, unsafe slug)
// so the caller can decide what to do — the router guard redirects to
// `/wiki`, the view watcher treats it as "render the index".
export function readWikiRouteTarget(params: unknown): WikiTarget | null {
  if (!params || typeof params !== "object") return null;
  const { section, slug } = params as { section?: unknown; slug?: unknown };

  if (section === undefined || section === "") return { kind: "index" };

  if (section === WIKI_ROUTE_SECTION.pages) {
    if (!isSafeWikiSlug(slug)) return null;
    return { kind: "page", slug };
  }
  if (section === WIKI_ROUTE_SECTION.log) return { kind: "log" };
  if (section === WIKI_ROUTE_SECTION.lintReport) return { kind: "lint_report" };

  return null;
}

// Inverse of `readWikiRouteTarget`: given a target, produce the
// `{ section, slug }` params object that `router.push({ name: "wiki",
// params })` needs.
//
// Optional route params are NOT cleared by named-route navigation
// unless explicitly set — returning `{}` for `kind: "index"` would
// leak the previous `section`/`slug` into the URL when navigating
// from `/wiki/pages/foo` back to the index, leaving the user on
// `/wiki/pages/foo` with the View believing it's the index. Pass
// empty strings so the router writes out `/wiki` cleanly. The
// readWikiRouteTarget() branch for `section === ""` already
// normalises those back to `{ kind: "index" }`.
export function buildWikiRouteParams(target: WikiTarget): Record<string, string> {
  switch (target.kind) {
    case "index":
      return { section: "", slug: "" };
    case "page":
      return { section: WIKI_ROUTE_SECTION.pages, slug: target.slug };
    case "log":
      return { section: WIKI_ROUTE_SECTION.log, slug: "" };
    case "lint_report":
      return { section: WIKI_ROUTE_SECTION.lintReport, slug: "" };
  }
}

// Resolve a target to the action name the server expects. Centralises
// the one place URL-shape and action-shape diverge (`lint-report` ↔
// `lint_report`).
export function wikiActionFor(target: WikiTarget): WikiAction {
  switch (target.kind) {
    case "index":
      return WIKI_ACTION.index;
    case "page":
      return WIKI_ACTION.page;
    case "log":
      return WIKI_ACTION.log;
    case "lint_report":
      return WIKI_ACTION.lintReport;
  }
}
