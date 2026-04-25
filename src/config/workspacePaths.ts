// Workspace-relative file paths — single source of truth.
//
// Shared by both the Vue frontend and the Express server.
// This file MUST NOT import node:path, node:os, or any Node-only
// module so it stays browser-compatible.
//
// The server's `server/workspace/paths.ts` imports these and
// joins them with the workspace root to produce absolute paths.

/** Well-known individual files. Values are workspace-relative paths. */
export const WORKSPACE_FILES = {
  memory: "conversations/memory.md",
  sessionToken: ".session-token",
  wikiIndex: "data/wiki/index.md",
  wikiLog: "data/wiki/log.md",
  wikiSchema: "data/wiki/SCHEMA.md",
  wikiSummary: "data/wiki/summary.md",
  summariesIndex: "conversations/summaries/_index.md",
  todosItems: "data/todos/todos.json",
  todosColumns: "data/todos/columns.json",
  schedulerItems: "data/scheduler/items.json",
  schedulerUserTasks: "config/scheduler/tasks.json",
  schedulerOverrides: "config/scheduler/overrides.json",
  newsReadState: "config/news-read-state.json",
} as const;
