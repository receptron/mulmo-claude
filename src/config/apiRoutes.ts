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
// frontend migration lands — see plans/done/refactor-api-routes-constants.md.
//
// **Adding a new endpoint**: add it here first, then reference the
// constant from the router file. Keep the nesting shallow and the
// key names matched to the last URL segment where possible.

import { CHAT_SERVICE_ROUTES } from "@mulmobridge/protocol";

export const API_ROUTES = {
  health: "/api/health",
  sandbox: "/api/sandbox",

  // Accounting plugin (opt-in, custom-Role only). One dispatch
  // endpoint per the action discriminator pattern (matches
  // todos.dispatch). UI route registration is intentionally absent
  // from src/router — the View is mounted via tool-result rendering,
  // never via a URL path. See plans/feat-accounting.md.
  accounting: {
    dispatch: "/api/accounting",
  },

  agent: {
    run: "/api/agent",
    cancel: "/api/agent/cancel",
    internal: {
      toolResult: "/api/internal/tool-result",
    },
  },

  chart: {
    present: "/api/present-chart",
  },

  chatIndex: {
    rebuild: "/api/chat-index/rebuild",
  },

  // Single source of truth: @mulmobridge/protocol. See plans/done/messaging_transports.md.
  chatService: CHAT_SERVICE_ROUTES,

  config: {
    base: "/api/config",
    settings: "/api/config/settings",
    mcp: "/api/config/mcp",
    workspaceDirs: "/api/config/workspace-dirs",
    referenceDirs: "/api/config/reference-dirs",
    schedulerOverrides: "/api/config/scheduler-overrides",
  },

  files: {
    tree: "/api/files/tree",
    dir: "/api/files/dir",
    content: "/api/files/content",
    raw: "/api/files/raw",
    refRoots: "/api/files/ref-roots",
  },

  html: {
    generate: "/api/generate-html",
    edit: "/api/edit-html",
    present: "/api/present-html",
    // Body carries the workspace-relative path so the route doesn't
    // have to reconstruct one from a basename — same shape as
    // plugins.updateMarkdown / image.update.
    update: "/api/htmls/update",
  },

  image: {
    generate: "/api/generate-image",
    edit: "/api/edit-image",
    upload: "/api/images",
    // Body carries the workspace-relative path so the route doesn't
    // have to reconstruct one from a basename — required after #764
    // sharded image storage by YYYY/MM.
    update: "/api/images/update",
  },

  // Generic attachment store (paste/drop/file-picker uploads). Saves
  // the file under data/attachments/YYYY/MM/<id>.<ext> and returns
  // the workspace-relative path. PPTX uploads also save a companion
  // .pdf; the PDF path is what the route returns so the LLM never
  // needs to know about the original PPTX. Image uploads use this
  // same route now — image.upload remains for canvas drawings.
  attachments: {
    upload: "/api/attachments",
  },

  mcpTools: {
    list: "/api/mcp-tools",
    invoke: "/api/mcp-tools/:tool",
  },

  notifications: {
    // PoC endpoint for scheduled push fan-out (Web pub-sub + bridge).
    // Scaffolding for #144 / #142 — see plans/done/feat-notification-push-scaffold.md.
    test: "/api/notifications/test",
  },

  journal: {
    // Most recent existing daily summary (today, falling back to
    // prior days). Backs the top-bar "today's journal" shortcut
    // (#876). Returns null when no daily summary has been generated
    // yet on this workspace.
    latestDaily: "/api/journal/latest-daily",
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
    // Body carries the workspace-relative path so the route doesn't
    // have to reconstruct one from a basename — required after #764
    // sharded artifact storage by YYYY/MM. Same shape as
    // image.update.
    updateMarkdown: "/api/markdowns/update",
    presentSpreadsheet: "/api/present-spreadsheet",
    updateSpreadsheet: "/api/spreadsheets/update",
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
    // GET /api/sessions/:id (read) + DELETE /api/sessions/:id (hard delete)
    detail: "/api/sessions/:id",
    markRead: "/api/sessions/:id/mark-read",
    bookmark: "/api/sessions/:id/bookmark",
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

  news: {
    items: "/api/news/items",
    itemBody: "/api/news/items/:id/body",
    readState: "/api/news/read-state",
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
    /** History routes (#763 PR 2). `:slug` and `:stamp` are filled in
     *  by the caller — the constants stay route-pattern shaped so the
     *  Express router and the Vue API layer share one source of truth. */
    pageHistory: "/api/wiki/pages/:slug/history",
    pageHistorySnapshot: "/api/wiki/pages/:slug/history/:stamp",
    pageHistoryRestore: "/api/wiki/pages/:slug/history/:stamp/restore",
    /** Internal endpoint hit by the LLM-write hook script
     *  (`<workspace>/.claude/hooks/wiki-snapshot.mjs`). Re-reads
     *  the just-written file from disk and routes it into the
     *  snapshot pipeline. Never called by the Vue client. */
    internalSnapshot: "/api/wiki/internal/snapshot",
  },
} as const;
