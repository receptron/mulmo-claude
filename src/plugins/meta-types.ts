// Shape every built-in plugin's `meta.ts` exports as `META`.
// Host aggregators (src/config/*, server/workspace/paths.ts) iterate
// over `BUILT_IN_PLUGIN_METAS` and auto-merge the per-dimension
// records. Plugin-specific literals never appear in host code — the
// plugin owns what the plugin owns.
//
// Browser-safe: no Vue / no Node-only imports. Both server and
// frontend can import this file (and via it, every plugin's META).

/** HTTP methods the route registry recognises. */
export type RouteMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A single route the plugin owns. The host composes the full URL
 *  as `/api/<apiNamespace><path>`; consumers read both `method` and
 *  the resolved `url` from the host registry. */
export interface RouteSpec {
  readonly method: RouteMethod;
  /** Sub-path under the namespace (`""` = the namespace root,
   *  `"/:id"` = a parameterised child). Express path syntax. */
  readonly path: string;
}

/** Resolved route — what the host registry hands back to consumers
 *  (server route registration AND client `apiCall`). The plugin
 *  declares `{ method, path }`; the host adds the `/api/<ns>` prefix
 *  and exposes `{ method, url }`. */
export interface ResolvedRoute {
  readonly method: RouteMethod;
  /** Full Express path including `/api/<namespace>` prefix. */
  readonly url: string;
}

/** Type-checking helper for a plugin's `meta.ts` literal. The
 *  `const` type parameter narrows nested literals (`toolName:
 *  "manageX"`, `apiRoutes.foo.path: "/:id"`, …) so host aggregators
 *  see the same string-literal types they would with
 *  `as const satisfies PluginMeta` — minus the dual annotation
 *  noise. Plugin authors write:
 *
 *  ```ts
 *  export const META = definePluginMeta({
 *    toolName: "manageX",
 *    apiNamespace: "x",
 *    apiRoutes: {
 *      dispatch: { method: "POST", path: "" },
 *    },
 *  });
 *  ``` */
export function definePluginMeta<const T extends PluginMeta>(meta: T): T {
  return meta;
}

/** A plugin's central-registry-facing metadata. */
export interface PluginMeta {
  /** MCP tool name string the LLM and JSONL files use. */
  readonly toolName: string;
  /** URL prefix segment under `/api/`. The plugin owns this slug;
   *  the host owns the `/api/` prefix. Defaults to `toolName` if
   *  omitted but most plugins prefer a shorter slug (e.g.
   *  `"accounting"` rather than `"manageAccounting"`).
   *
   *  Also doubles as the outer key under `API_ROUTES` — so
   *  `API_ROUTES.<apiNamespace>.<routeKey>` is `{ method, url }`. */
  readonly apiNamespace?: string;
  /** Routes owned by this plugin. Each value declares an HTTP
   *  method and a sub-path; the host composes the full URL as
   *  `/api/<apiNamespace><path>`. */
  readonly apiRoutes?: Readonly<Record<string, RouteSpec>>;
  /** MCP-bridge dispatch route key. Names the entry in `apiRoutes`
   *  the MCP server posts tool calls to. Lets `BUILT_IN_SERVER_BINDINGS`
   *  derive the binding's URL from META instead of repeating it. */
  readonly mcpDispatch?: string;
  /** Workspace-relative directories owned by this plugin (flat
   *  keys). Merged into the central `WORKSPACE_DIRS` so existing
   *  call sites (`WORKSPACE_DIRS.accounting`) keep working. */
  readonly workspaceDirs?: Readonly<Record<string, string>>;
  /** Static pubsub channel names owned by this plugin (flat keys).
   *  Merged into the central `PUBSUB_CHANNELS`. Channel factories
   *  (e.g. `bookChannel(bookId)`) are not part of this map — they
   *  live as separate named exports in the plugin's `meta.ts`
   *  because their signatures are plugin-specific. */
  readonly staticChannels?: Readonly<Record<string, string>>;
  /** Optional host binaries this plugin's features need (ids from
   *  the optional-deps registry, e.g. `["ffmpeg"]`). When any is
   *  missing the host warns the user once and the plugin's
   *  dependency-bound features degrade gracefully — see #1385. */
  readonly requires?: readonly string[];
}

/** Substitute `:param` placeholders in a route URL with caller-
 *  provided values. URL-encodes each value so `/foo bar` and
 *  `?injection=1` survive intact. */
export function buildRouteUrl(route: ResolvedRoute, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return route.url;
  // Single-pass token replacement: substituting param-by-param would let
  // one value rewrite a longer placeholder it prefixes (`:id` vs `:idx`).
  // Own-property check so a `:constructor` placeholder never reads
  // `Object.prototype`. (`Object.hasOwn` needs es2022 lib — not enabled.)
  return route.url.replace(/:([A-Za-z0-9_]+)/g, (placeholder, name: string) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) return placeholder;
    return encodeURIComponent(String(params[name]));
  });
}
