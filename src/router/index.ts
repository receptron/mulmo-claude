// Vue-router setup (history mode — clean URLs without #).
//
// Each page has its own route: /chat, /files, /todos, /scheduler,
// /wiki, /skills, /roles. Layout preference (single vs. stack) is a
// separate concern persisted in localStorage — it is not part of the
// URL.
//
// History mode requires the server to serve index.html for any path
// that doesn't match an API route or static file. In production the
// Express catch-all `app.get("*", ...)` in server/index.ts already
// does this. In dev, Vite's default SPA fallback handles it.

import { defineComponent, h } from "vue";
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

// Stub component that renders nothing. Required by vue-router (every
// route needs a component) but never actually mounted because App.vue
// renders based on `route.name` rather than using <router-view>.
const Stub = defineComponent({ render: () => h("div") });

export const PAGE_ROUTES = {
  chat: "chat",
  files: "files",
  todos: "todos",
  scheduler: "scheduler",
  wiki: "wiki",
  skills: "skills",
  roles: "roles",
} as const;

export type PageRouteName = (typeof PAGE_ROUTES)[keyof typeof PAGE_ROUTES];

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
  { path: "/todos", name: PAGE_ROUTES.todos, component: Stub },
  { path: "/scheduler", name: PAGE_ROUTES.scheduler, component: Stub },
  { path: "/wiki", name: PAGE_ROUTES.wiki, component: Stub },
  { path: "/skills", name: PAGE_ROUTES.skills, component: Stub },
  { path: "/roles", name: PAGE_ROUTES.roles, component: Stub },
  { path: "/:pathMatch(.*)*", redirect: "/chat" },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
