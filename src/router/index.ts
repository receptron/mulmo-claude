// Vue-router setup (history mode — clean URLs without #).
//
// The route is /chat/:sessionId? which captures the session the user
// was looking at. Everything else (view mode, file path, result uuid,
// role) lives in query parameters and will be wired in later phases.
//
// The "/" → "/chat" redirect ensures a fresh browser tab always lands
// on the chat view with the default (new) session, matching the
// current pre-router behaviour.
//
// History mode requires the server to serve index.html for any path
// that doesn't match an API route or static file. In production the
// Express catch-all `app.get("*", ...)` in server/index.ts already
// does this. In dev, Vite's default SPA fallback handles it.

import { defineComponent, h } from "vue";
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";

// Stub component that renders nothing. Required by vue-router (every
// route needs a component) but never actually mounted because App.vue
// doesn't contain <router-view> in Phase 0.
const Stub = defineComponent({ render: () => h("div") });

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    redirect: "/chat",
  },
  {
    // sessionId is optional — /chat with no param means "new session"
    // (the App.vue logic that auto-creates a session continues to
    // handle this).
    path: "/chat/:sessionId?",
    name: "chat",
    component: Stub,
  },
  {
    // Catch-all: unknown paths redirect to /chat so a stale bookmark
    // or a typo doesn't show a blank page.
    path: "/:pathMatch(.*)*",
    redirect: "/chat",
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
