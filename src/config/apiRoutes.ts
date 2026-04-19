// Single source of truth for every HTTP endpoint the server exposes
// under `/api/*`. Issue #289 (part 1) — consolidate the 77+ route
// registrations and ~57 frontend `fetch("/api/...")` call sites so
// that typos fail typecheck instead of producing runtime 404s.
//
// **Shape**: nested `as const` object grouped by owning route file /
// resource family. Every value is the literal, full path including
// the `/api` prefix. Routers in `server/routes/*.ts` register them
// verbatim — the `app.use("/api", ...)` mount prefix was removed so
// the constants are the unambiguous source.
//
// **Express params**: patterns like `:id` / `:filename` are kept as
// Express-compatible strings. Client-side URL builders (e.g. a
// `todoItem(id)` helper) are deliberately NOT added here until the
// frontend migration lands — see plans/refactor-api-routes-constants.md.
//
// **Adding a new endpoint**: add it here first, then reference the
// constant from the router file. Keep the nesting shallow and the
// key names matched to the last URL segment where possible.

import { CHAT_SERVICE_ROUTES } from "@mulmobridge/protocol";

export const API_ROUTES = {
  health: "/api/health",
  sandbox: "/api/sandbox",

  agent: {
    run: "/api/agent",
    cancel: "/api/agent/cancel",
    internal: {
      toolResult: "/api/internal/tool-result",
      switchRole: "/api/internal/switch-role",
    },
  },

  chart: {
    present: "/api/present-chart",
  },

  chatIndex: {
    rebuild: "/api/chat-index/rebuild",
  },

  // Single source of truth: @mulmobridge/protocol. See plans/messaging_transports.md.
  chatService: CHAT_SERVICE_ROUTES,

  config: {
    base: "/api/config",
    settings: "/api/config/settings",
    mcp: "/api/config/mcp",
  },

  files: {
    tree: "/api/files/tree",
    dir: "/api/files/dir",
    content: "/api/files/content",
    raw: "/api/files/raw",
  },

  html: {
    generate: "/api/generate-html",
    edit: "/api/edit-html",
    present: "/api/present-html",
  },

  image: {
    generate: "/api/generate-image",
    edit: "/api/edit-image",
    upload: "/api/images",
    update: "/api/images/:filename",
  },

  mcpTools: {
    list: "/api/mcp-tools",
    invoke: "/api/mcp-tools/:tool",
  },

  notifications: {
    // PoC endpoint for scheduled push fan-out (Web pub-sub + bridge).
    // Scaffolding for #144 / #142 — see plans/feat-notification-push-scaffold.md.
    test: "/api/notifications/test",
  },

  mulmoScript: {
    save: "/api/mulmo-script",
    updateBeat: "/api/mulmo-script/update-beat",
    updateScript: "/api/mulmo-script/update-script",
    beatImage: "/api/mulmo-script/beat-image",
    beatAudio: "/api/mulmo-script/beat-audio",
    generateBeatAudio: "/api/mulmo-script/generate-beat-audio",
    renderBeat: "/api/mulmo-script/render-beat",
    uploadBeatImage: "/api/mulmo-script/upload-beat-image",
    characterImage: "/api/mulmo-script/character-image",
    renderCharacter: "/api/mulmo-script/render-character",
    uploadCharacterImage: "/api/mulmo-script/upload-character-image",
    movieStatus: "/api/mulmo-script/movie-status",
    generateMovie: "/api/mulmo-script/generate-movie",
    downloadMovie: "/api/mulmo-script/download-movie",
  },

  pdf: {
    markdown: "/api/pdf/markdown",
  },

  // Plugin-owned endpoints that don't follow a single naming pattern.
  // Names match the plugin tool name or the short verb the plugin uses.
  plugins: {
    presentDocument: "/api/present-document",
    updateMarkdown: "/api/markdowns/:filename",
    presentSpreadsheet: "/api/present-spreadsheet",
    updateSpreadsheet: "/api/spreadsheets/:filename",
    mindmap: "/api/mindmap",
    quiz: "/api/quiz",
    form: "/api/form",
    canvas: "/api/canvas",
    present3d: "/api/present3d",
  },

  roles: {
    list: "/api/roles",
    manage: "/api/roles/manage",
  },

  scheduler: {
    base: "/api/scheduler",
    tasks: "/api/scheduler/tasks",
    task: "/api/scheduler/tasks/:id",
    taskRun: "/api/scheduler/tasks/:id/run",
    logs: "/api/scheduler/logs",
  },

  sessions: {
    list: "/api/sessions",
    // GET /api/sessions/:id + POST /api/sessions/:id/mark-read
    detail: "/api/sessions/:id",
    markRead: "/api/sessions/:id/mark-read",
  },

  skills: {
    list: "/api/skills",
    detail: "/api/skills/:name",
    create: "/api/skills",
    update: "/api/skills/:name",
    remove: "/api/skills/:name",
  },

  sources: {
    list: "/api/sources",
    create: "/api/sources",
    remove: "/api/sources/:slug",
    rebuild: "/api/sources/rebuild",
    manage: "/api/sources/manage",
  },

  todos: {
    list: "/api/todos",
    dispatch: "/api/todos",
    items: "/api/todos/items",
    item: "/api/todos/items/:id",
    itemMove: "/api/todos/items/:id/move",
    columns: "/api/todos/columns",
    column: "/api/todos/columns/:id",
    columnsOrder: "/api/todos/columns/order",
  },

  wiki: {
    base: "/api/wiki",
  },
} as const;
