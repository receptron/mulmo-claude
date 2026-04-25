// Vue-router setup (history mode — clean URLs without #).
//
// Each page has its own route: /chat, /files, /todos, /calendar,
// /automations, /wiki, /skills, /roles, /sources. Layout preference
// (single vs. stack) is a separate concern persisted in localStorage
// — it is not part of the URL. Several pages accept an optional
// identifier (todos :itemId, automations :taskId, sources :slug) so
// notifications and external links can deep-link to a specific item.
//
// History mode requires the server to serve index.html for any path
// that doesn't match an API route or static file. In production the
// Express catch-all `app.get("*", ...)` in server/index.ts already
// does this. In dev, Vite's default SPA fallback handles it.

import { defineComponent, h } from "vue";
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { PAGE_ROUTES, type PageRouteName } from "./pageRoutes";

// Re-export the constants so existing `import { PAGE_ROUTES } from
// "./router"` call sites keep working. The actual definitions live
// in `./pageRoutes` — that module is safe to import from node-side
// tests, which this module is not (createWebHistory touches window
// at module-eval time).
export { PAGE_ROUTES, type PageRouteName };

// Stub component that renders nothing. Required by vue-router (every
// route needs a component) but never actually mounted because App.vue
// renders based on `route.name` rather than using <router-view>.
const Stub = defineComponent({ render: () => h("div") });

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/chat" },
  { path: "/chat/:sessionId?", name: PAGE_ROUTES.chat, component: Stub },
  // Files view uses a repeatable catch-all so `/files/a/b/c.md` maps
  // to `params.pathMatch = ["a", "b", "c.md"]`. Joining on `/` at read
  // time keeps each segment URL-encoded independently — passing a
  // string-form catch-all (`:pathMatch(.*)`) would collapse slashes
  // to `%2F` at push time and mangle deep paths. An empty segment
  // (`/files`) yields an empty array, which we treat as "no file
  // selected". See plans/feat-files-path-url.md.
  { path: "/files/:pathMatch(.*)*", name: PAGE_ROUTES.files, component: Stub },
  // Todos accepts an optional `:itemId` so notifications / deep-links
  // can jump to a specific card. Missing id falls through to the
  // board index view. See plans/feat-notification-permalinks.md.
  { path: "/todos/:itemId?", name: PAGE_ROUTES.todos, component: Stub },
  { path: "/calendar", name: PAGE_ROUTES.calendar, component: Stub },
  // Automations accepts an optional `:taskId` for the same reason —
  // scheduled-task notifications deep-link to a specific task row.
  { path: "/automations/:taskId?", name: PAGE_ROUTES.automations, component: Stub },
  // Legacy Scheduler URL — split into Calendar + Automations (#758).
  // Redirect preserves bookmarks; delete once telemetry shows no hits.
  { path: "/scheduler", redirect: "/calendar" },
  // Wiki sub-views live on the path rather than in query params so
  // URLs mirror the filesystem layout (`data/wiki/pages/<slug>.md`)
  // and stay sibling-safe (no query-key bleed from other routes).
  // `section` is a closed enum; unknown sections fall through to the
  // catch-all redirect below. `slug` only applies when `section ===
  // "pages"`. See plans/feat-wiki-path-urls.md.
  { path: "/wiki/:section(pages|log|lint-report)?/:slug?", name: PAGE_ROUTES.wiki, component: Stub },
  { path: "/skills", name: PAGE_ROUTES.skills, component: Stub },
  { path: "/roles", name: PAGE_ROUTES.roles, component: Stub },
  // Sources accepts an optional `:slug` so notifications / deep-links
  // can surface a specific registered feed. Missing slug lands on
  // the full source list.
  { path: "/sources/:slug?", name: PAGE_ROUTES.sources, component: Stub },
  // News viewer (#761). Optional `?source=<slug>` query for the
  // Sources-page deep link.
  { path: "/news", name: PAGE_ROUTES.news, component: Stub },
  { path: "/:pathMatch(.*)*", redirect: "/chat" },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
