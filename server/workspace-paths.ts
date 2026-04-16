// Single source of truth for workspace directory / file names and
// their absolute paths. Before this module, ~15 call sites each
// wrote `path.join(workspacePath, "wiki")` / "markdowns" / etc. by
// hand — renaming a directory meant grep-and-edit across the
// server, with no typecheck help against typos.
//
// **This module does not change any paths.** Every name here is
// the string that was previously baked into its call site, so
// centralizing is a pure source-level refactor — no files move.
// The layout rethink + migration that issue #284 proposes will
// happen on top of this, by re-mapping the values below.
//
// When adding a new top-level directory: add the name to the
// `WORKSPACE_DIRS` record below. The absolute path is derived
// automatically via `WORKSPACE_PATHS`.

import os from "os";
import path from "path";

// Workspace root. Hard-coded to `~/mulmoclaude` — there is no
// WORKSPACE_PATH env override today; changing the location
// requires a code edit or a symlink. Re-exported by
// `server/workspace.ts` for backwards compatibility of existing
// callers that `import { workspacePath } from "./workspace.js"`.
export const workspacePath = path.join(os.homedir(), "mulmoclaude");

// Top-level directory *names*. Use these when you need the bare
// name (e.g. a relative path in a response envelope): most code
// should reach for `WORKSPACE_PATHS` instead.
export const WORKSPACE_DIRS = {
  chat: "chat",
  todos: "todos",
  calendar: "calendar",
  contacts: "contacts",
  scheduler: "scheduler",
  roles: "roles",
  stories: "stories",
  images: "images",
  markdowns: "markdowns",
  spreadsheets: "spreadsheets",
  charts: "charts",
  configs: "configs",
  helps: "helps",
  wiki: "wiki",
  news: "news",
  sources: "sources",
  summaries: "summaries",
  // presentHtml plugin writes here. Note the legacy capitalization
  // — issue #284 will consider normalizing to lower-case `html/`.
  htmls: "HTMLs",
  // Distinct from `htmls` above: transient render output by the
  // raw `html` route (server/routes/html.ts). Co-exists with
  // `HTMLs/` on disk today.
  html: "html",
  transports: "transports",
} as const;

// File names at the workspace root (not under a subdirectory).
export const WORKSPACE_FILES = {
  memory: "memory.md",
  // Bearer auth token (#272). Written at server startup, mode 0600, read
  // by the Vite plugin (dev) / Express HTML serve (prod) to inject into
  // the `<meta name="mulmoclaude-auth">` tag, and by CLI bridges
  // (Phase 2) to pick up Authorization headers. Deleted on graceful
  // shutdown; stale files after a crash are harmless since the next
  // startup regenerates and the in-memory token is the only one checked.
  sessionToken: ".session-token",
} as const;

// Absolute paths, built once at module load from `workspacePath`.
// The `workspacePath` const is itself fixed (reads `os.homedir()`
// at process start — no env override, see `server/workspace.ts`),
// so freezing these paths is safe.
export const WORKSPACE_PATHS = {
  chat: path.join(workspacePath, WORKSPACE_DIRS.chat),
  todos: path.join(workspacePath, WORKSPACE_DIRS.todos),
  calendar: path.join(workspacePath, WORKSPACE_DIRS.calendar),
  contacts: path.join(workspacePath, WORKSPACE_DIRS.contacts),
  scheduler: path.join(workspacePath, WORKSPACE_DIRS.scheduler),
  roles: path.join(workspacePath, WORKSPACE_DIRS.roles),
  stories: path.join(workspacePath, WORKSPACE_DIRS.stories),
  images: path.join(workspacePath, WORKSPACE_DIRS.images),
  markdowns: path.join(workspacePath, WORKSPACE_DIRS.markdowns),
  spreadsheets: path.join(workspacePath, WORKSPACE_DIRS.spreadsheets),
  charts: path.join(workspacePath, WORKSPACE_DIRS.charts),
  configs: path.join(workspacePath, WORKSPACE_DIRS.configs),
  helps: path.join(workspacePath, WORKSPACE_DIRS.helps),
  wiki: path.join(workspacePath, WORKSPACE_DIRS.wiki),
  news: path.join(workspacePath, WORKSPACE_DIRS.news),
  sources: path.join(workspacePath, WORKSPACE_DIRS.sources),
  summaries: path.join(workspacePath, WORKSPACE_DIRS.summaries),
  htmls: path.join(workspacePath, WORKSPACE_DIRS.htmls),
  html: path.join(workspacePath, WORKSPACE_DIRS.html),
  transports: path.join(workspacePath, WORKSPACE_DIRS.transports),
  memory: path.join(workspacePath, WORKSPACE_FILES.memory),
  sessionToken: path.join(workspacePath, WORKSPACE_FILES.sessionToken),
} as const;

export type WorkspaceDirKey = keyof typeof WORKSPACE_DIRS;
export type WorkspacePathKey = keyof typeof WORKSPACE_PATHS;

// Directories `initWorkspace()` creates eagerly on server start.
// Kept as a subset of `WORKSPACE_DIRS` so new entries are additive
// without touching `server/workspace.ts`. Everything *not* on this
// list is created lazily (first write) by its owning module.
export const EAGER_WORKSPACE_DIRS: readonly WorkspaceDirKey[] = [
  "chat",
  "todos",
  "calendar",
  "contacts",
  "scheduler",
  "roles",
  "stories",
  "images",
  "markdowns",
  "spreadsheets",
  "charts",
  "configs",
];
