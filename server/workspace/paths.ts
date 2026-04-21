// Single source of truth for workspace directory / file names and
// their absolute paths. The record below uses workspace-relative
// paths (possibly multi-segment, e.g. `config/roles`) as values; code
// looks up via `WORKSPACE_PATHS.<key>` to get the absolute form.
//
// Layout grouping (issue #284):
//
//   config/          settings + roles + helps
//   conversations/   chat + memory.md + summaries
//   data/            user-managed (wiki, todos, calendar, contacts,
//                    scheduler, sources, transports)
//   artifacts/       LLM-generated (charts, html, images, documents,
//                    spreadsheets, stories, news)
//
// Existing workspaces need the one-shot `scripts/migrate-workspace-284.ts`
// script run before first startup with this code. `server/workspace.ts`
// detects the pre-migration layout at boot and aborts with a pointer
// to the script.
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

// Workspace-relative paths. Keys are the stable code-side identifiers
// (e.g. `markdowns` — unchanged for call-site compatibility); values
// are the on-disk paths, grouped per issue #284.
export const WORKSPACE_DIRS = {
  // conversations/
  chat: "conversations/chat",
  summaries: "conversations/summaries",
  // Tool-trace output for WebSearch (one .md per search, referenced
  // from chat JSONL `contentRef`). Lives alongside chat/ so search
  // trace and chat session share the same grouping.
  searches: "conversations/searches",
  // data/
  wiki: "data/wiki",
  todos: "data/todos",
  calendar: "data/calendar",
  contacts: "data/contacts",
  scheduler: "data/scheduler",
  sources: "data/sources",
  transports: "data/transports",
  // artifacts/
  charts: "artifacts/charts",
  // `markdowns` key preserved for call-site compatibility; on-disk
  // name is `documents` for clarity.
  markdowns: "artifacts/documents",
  // `htmls` = `presentHtml` plugin output (many files, persistent).
  // On-disk normalized to lowercase `html`.
  htmls: "artifacts/html",
  // Distinct from `htmls`: scratch buffer for the `/api/html`
  // generate-and-preview route. One file (`current.html`), always
  // overwritten. Kept separate so reloading a saved HTML artifact
  // doesn't clobber the current preview.
  html: "artifacts/html-scratch",
  images: "artifacts/images",
  spreadsheets: "artifacts/spreadsheets",
  stories: "artifacts/stories",
  news: "artifacts/news",
  // config/
  configs: "config",
  roles: "config/roles",
  helps: "config/helps",
  // Nested subdirs inside a top-level grouping. Kept here (rather
  // than module-local constants) when multiple modules need to
  // reference the same nested path — e.g. wiki/pages/ is used by
  // the wiki route, the wiki-backlinks driver, and the system
  // prompt hint.
  wikiPages: "data/wiki/pages",
  wikiSources: "data/wiki/sources",
  // Development — git-cloned repositories (#256).
  github: "github",
} as const;

// Well-known individual files — imported from the shared
// src/config/workspacePaths.ts (single source of truth for both
// server and frontend). Re-exported so server callers keep the
// same `import { WORKSPACE_FILES } from "./paths.js"` they use.
import { WORKSPACE_FILES } from "../../src/config/workspacePaths.js";
export { WORKSPACE_FILES };

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
  searches: path.join(workspacePath, WORKSPACE_DIRS.searches),
  htmls: path.join(workspacePath, WORKSPACE_DIRS.htmls),
  html: path.join(workspacePath, WORKSPACE_DIRS.html),
  transports: path.join(workspacePath, WORKSPACE_DIRS.transports),
  github: path.join(workspacePath, WORKSPACE_DIRS.github),
  // nested subdirs
  wikiPages: path.join(workspacePath, WORKSPACE_DIRS.wikiPages),
  wikiSources: path.join(workspacePath, WORKSPACE_DIRS.wikiSources),
  // files
  memory: path.join(workspacePath, WORKSPACE_FILES.memory),
  sessionToken: path.join(workspacePath, WORKSPACE_FILES.sessionToken),
  wikiIndex: path.join(workspacePath, WORKSPACE_FILES.wikiIndex),
  wikiLog: path.join(workspacePath, WORKSPACE_FILES.wikiLog),
  wikiSchema: path.join(workspacePath, WORKSPACE_FILES.wikiSchema),
  wikiSummary: path.join(workspacePath, WORKSPACE_FILES.wikiSummary),
  summariesIndex: path.join(workspacePath, WORKSPACE_FILES.summariesIndex),
  todosItems: path.join(workspacePath, WORKSPACE_FILES.todosItems),
  todosColumns: path.join(workspacePath, WORKSPACE_FILES.todosColumns),
  schedulerItems: path.join(workspacePath, WORKSPACE_FILES.schedulerItems),
  schedulerUserTasks: path.join(workspacePath, WORKSPACE_FILES.schedulerUserTasks),
  schedulerOverrides: path.join(workspacePath, WORKSPACE_FILES.schedulerOverrides),
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
  "github",
];
