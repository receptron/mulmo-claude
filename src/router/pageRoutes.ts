// Page route names — the canonical list of top-level views.
//
// Kept in its own file (instead of re-exported from router/index.ts)
// so that modules importing the constant do not transitively pull in
// `createRouter` / `createWebHistory`, which access `window` at
// module-eval time and therefore can't run under node-side tests.
// See plans/done/feat-notification-permalinks.md (#762) for the test that
// forced the split.

export const PAGE_ROUTES = {
  chat: "chat",
  files: "files",
  todos: "todos",
  calendar: "calendar",
  automations: "automations",
  wiki: "wiki",
  skills: "skills",
  roles: "roles",
  sources: "sources",
  news: "news",
} as const;

export type PageRouteName = (typeof PAGE_ROUTES)[keyof typeof PAGE_ROUTES];
