// Single source of truth for every HTTP endpoint the server exposes
// under `/api/*`. Issue #289 (part 1) — consolidate the 77+ route
// registrations and ~57 frontend `fetch("/api/...")` call sites so
// that typos fail typecheck instead of producing runtime 404s.
//
// **Two shapes coexist**:
//
//   - **Host routes** (this file's `HOST_API_ROUTES` literal): values
//     are full URL strings. Used by host-only routes (`/api/agent`,
//     `/api/wiki`, …) where the method is implicit at the call site.
//   - **Plugin routes** (auto-merged from each plugin's META): values
//     are `ResolvedRoute = { method, url }` records. The plugin
//     declares `{ apiNamespace, apiRoutes: { key: { method, path } } }`
//     and the host composes `/api/<apiNamespace><path>` with the
//     `method` flowing through to the value. Plugin-owned dispatch
//     URLs and HTTP verbs land in the same place at the same time.
//
// **Adding a new host endpoint**: add it to `HOST_API_ROUTES` below;
// reference it from the route file as a string.
// **Adding a new plugin endpoint**: edit the plugin's `meta.ts` —
// the host aggregator picks it up automatically.

import { CHAT_SERVICE_ROUTES } from "@mulmobridge/protocol";
import { BUILT_IN_PLUGIN_METAS, defineHostAggregate, type BuiltInPluginMetas, type HostPluginCollision, type IntraPluginCollision } from "../plugins/metas";
import type { ResolvedRoute, RouteSpec } from "../plugins/meta-types";

// Plugin-owned API routes auto-merged from each plugin's META. Each
// plugin's `apiNamespace` becomes the outer key under `API_ROUTES`
// (defaulting to `toolName` when omitted); each route key's value
// is `ResolvedRoute = { method, url }` with `url` composed as
// `/api/<apiNamespace><path>`. Plugins without `apiRoutes` are skipped.
type ResolveRoutes<R extends Readonly<Record<string, RouteSpec>>> = {
  readonly [K in keyof R]: ResolvedRoute;
};
type PluginApiRoutesMap<T extends BuiltInPluginMetas> = {
  readonly [M in T[number] as M extends { readonly apiRoutes: Readonly<Record<string, RouteSpec>> }
    ? M extends { readonly apiNamespace: infer K extends string }
      ? K
      : M["toolName"]
    : never]: M extends { readonly apiRoutes: infer R extends Readonly<Record<string, RouteSpec>> } ? ResolveRoutes<R> : never;
};

/** Resolve every plugin route into a `ResolvedRoute` keyed by the
 *  same name the META used. Used by the aggregator extractor; kept
 *  exported so server-side helpers can compose the same URLs from
 *  any META (e.g. `BUILT_IN_SERVER_BINDINGS.mcpDispatch` lookup). */
export function resolvePluginRoutes(namespace: string, routes: Readonly<Record<string, RouteSpec>>): Record<string, ResolvedRoute> {
  const resolved: Record<string, ResolvedRoute> = {};
  for (const [key, spec] of Object.entries(routes)) {
    resolved[key] = { method: spec.method, url: `/api/${namespace}${spec.path}` };
  }
  return resolved;
}

const HOST_API_ROUTES = {
  health: "/api/health",
  sandbox: "/api/sandbox",

  agent: {
    run: "/api/agent",
    cancel: "/api/agent/cancel",
    internal: {
      toolResult: "/api/internal/tool-result",
    },
  },

  // `chart` group migrated to META — see `src/plugins/chart/meta.ts`.
  // Auto-merged into `API_ROUTES.chart` via `apiRoutesKey: "chart"`.

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

  // `html` group migrated to META — see `src/plugins/presentHtml/meta.ts`.
  // Auto-merged via `apiRoutesKey: "html"`.

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

  // `mulmoScript` group migrated to META — see `src/plugins/presentMulmoScript/meta.ts`.
  // Auto-merged via `apiNamespace: "mulmoScript"`.

  pdf: {
    markdown: "/api/pdf/markdown",
  },

  translation: {
    translate: "/api/translation",
  },

  // Lightweight runtime-config endpoint — currently exposes only
  // `devMode` for the Debug-role gate. Future host-level runtime
  // flags can join here without minting a new namespace per flag.
  system: {
    config: "/api/system/config",
  },

  // Plugin-owned endpoints that don't follow a single naming pattern.
  // Names match the plugin tool name or the short verb the plugin uses.
  plugins: {
    // `presentDocument` / `updateMarkdown` migrated to META — see
    // `src/plugins/markdown/meta.ts`. Auto-merged via
    // `apiRoutesKey: "presentDocument"`.
    // `presentSpreadsheet` / `updateSpreadsheet` migrated to META —
    // see `src/plugins/spreadsheet/meta.ts`. Auto-merged via
    // `apiRoutesKey: "presentSpreadsheet"`.
    mindmap: "/api/mindmap",
    quiz: "/api/quiz",
    // `form` and `canvas` migrated to META — exposed at top-level
    // `API_ROUTES.presentForm.dispatch` / `API_ROUTES.canvas.dispatch`.
    present3d: "/api/present3d",
    // Runtime-loaded plugins (#1043 C-2). One generic dispatch
    // endpoint shared by every workspace-installed plugin; the URL
    // pkg parameter is the URL-encoded npm package name (e.g.
    // `%40gui-chat-plugin%2Fweather`). Matched against the runtime
    // registry server-side; the registry's plugin.execute() handles
    // the call.
    runtimeList: "/api/plugins/runtime/list",
    runtimeDispatch: "/api/plugins/runtime/:pkg/dispatch",
    /** Generic OAuth callback receiver for runtime plugins (#1162).
     *  The plugin declares a short alias (e.g. `OAUTH_CALLBACK_ALIAS
     *  = "spotify"`) and registers this URL as the redirect_uri in
     *  its provider's developer dashboard. The host extracts the
     *  alias, looks up the plugin in the registry, and forwards
     *  `{ code, state, error }` as `kind: "oauthCallback"` dispatch
     *  args.
     *
     *  Why a short alias instead of the npm package name in the path?
     *  Spotify's Dashboard rejects redirect URIs containing
     *  percent-encoded `@` / `/` characters (the natural shape when
     *  the npm scoped name lands in a single path segment), so each
     *  OAuth-using plugin declares its own short, alphanumeric alias.
     *  Collisions are detected at boot and logged.
     *
     *  Bearer-auth-EXEMPT (browser redirect carries no Authorization
     *  header); CSRF defended by the plugin's single-use `state`. */
    runtimeOauthCallback: "/api/plugins/runtime/oauth-callback/:alias",
    /** Boot-time META aggregator collisions (host vs plugin, plugin
     *  vs plugin). Returns an empty array when clean. Frontend
     *  fetches once at mount so a tab that opens after server boot
     *  still surfaces the warning toast + bell entry. See
     *  `server/plugins/diagnostics.ts`. */
    diagnostics: "/api/plugins/diagnostics",
    /** Static-mount of the extracted plugin tree. The URL pkg is the
     *  un-encoded npm name plus version dir. Used by the frontend
     *  loader's dynamic `import()` to fetch `dist/vue.js`.
     *
     *  Express 5 path-to-regexp uses `/{*name}` for catch-all
     *  wildcards (the bare `*` from Express 4 throws at registration).
     *  Handler reads the wildcard via `req.params.splat`. */
    runtimeAsset: "/api/plugins/runtime/:pkg/:version/{*splat}",
  },

  roles: {
    list: "/api/roles",
    manage: "/api/roles/manage",
  },

  // `scheduler` group migrated to META — see `src/plugins/scheduler/calendarMeta.ts`.
  // Auto-merged via `apiNamespace: "scheduler"`.

  sessions: {
    list: "/api/sessions",
    // GET /api/sessions/:id (read) + DELETE /api/sessions/:id (hard delete)
    detail: "/api/sessions/:id",
    markRead: "/api/sessions/:id/mark-read",
    bookmark: "/api/sessions/:id/bookmark",
  },

  // `skills` group migrated to META — see `src/plugins/manageSkills/meta.ts`.
  // `sources` group migrated to META — see `src/plugins/manageSource/meta.ts`.

  news: {
    items: "/api/news/items",
    itemBody: "/api/news/items/:id/body",
    readState: "/api/news/read-state",
  },

  // todos: removed — todo is now a runtime plugin
  // (`@mulmoclaude/todo-plugin`, #1145 migration). The frontend
  // calls into it via `runtime.dispatch({kind: ...})` from
  // `useTodos` (`@mulmoclaude/todo-plugin/composables`); no
  // host-managed routes remain.

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

// First-write-wins host+plugin aggregate (see `defineHostAggregate`):
// host outer-keys win on collision (plugins claiming `agent`/`roles`/
// `wiki` are dropped), the second-claiming plugin's `apiNamespace`
// is dropped, both diagnostic lists are exposed for boot warnings.
//
// The aggregator's value-type union spans:
//   - host string URLs (`/api/health`),
//   - host nested groups (`{ run, cancel, internal }`),
//   - plugin route maps (`Record<string, ResolvedRoute>` produced by
//     `resolvePluginRoutes`).
// `defineHostAggregate` is runtime-generic; the cast on the merged
// result narrows it back to the literal-preserving shape above.
type ApiRoutesAggregateValue =
  | (typeof HOST_API_ROUTES)[keyof typeof HOST_API_ROUTES]
  | Readonly<Record<string, string>>
  | Readonly<Record<string, ResolvedRoute>>;

const API_ROUTES_AGGREGATE = defineHostAggregate<ApiRoutesAggregateValue>(BUILT_IN_PLUGIN_METAS, {
  label: "API_ROUTES",
  hostRecord: HOST_API_ROUTES,
  extract: (meta) => {
    if (meta.apiRoutes === undefined) return undefined;
    const namespace = meta.apiNamespace ?? meta.toolName;
    return { [namespace]: resolvePluginRoutes(namespace, meta.apiRoutes) };
  },
  dimension: "apiNamespace",
});
export const API_ROUTES_HOST_COLLISIONS: readonly HostPluginCollision[] = API_ROUTES_AGGREGATE.hostCollisions;
export const API_ROUTES_INTRA_COLLISIONS: readonly IntraPluginCollision[] = API_ROUTES_AGGREGATE.intraCollisions;

export const API_ROUTES = API_ROUTES_AGGREGATE.merged as unknown as typeof HOST_API_ROUTES & PluginApiRoutesMap<BuiltInPluginMetas>;
