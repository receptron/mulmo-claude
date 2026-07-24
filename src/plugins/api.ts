// Plugin-side DI container.
//
// Plugins must NOT import from `src/config/*` (the host's URL /
// constants registry) — the host owns those values and decides
// when / how to provide them. This file is the indirection: plugins
// call the getters here; the host wires the actual values once at
// boot via `installHostContext`.
//
// Loose coupling means:
//
//   - This file references zero `src/config/*` modules. The
//     `HostContext` interface declares only the contract — the
//     host is free to swap in test doubles, runtime overrides, or
//     a future server-driven config without touching any plugin.
//   - Plugins import `pluginEndpoints` / `pluginPageRoute` / etc.
//     from `../api`; they never see `API_ROUTES`, `PAGE_ROUTES`,
//     `BUILTIN_ROLE_IDS`, or `getAllPluginNames` directly.
//   - Tests install their own `HostContext` via the same
//     `installHostContext` entry point (see
//     `test/helpers/installHostContext.ts`).
//
// Adding a new injected capability: add a typed field to
// `HostContext`, a corresponding getter helper here, and update
// the host's install call in `src/main.ts`.

import type { ResolvedRoute } from "./meta-types";

/** A flat group of plugin-owned routes (`{ create: { method, url } }`).
 *  Each plugin scope maps to one of these. The host registry hands
 *  back resolved-URL records — the plugin author wrote `{ method,
 *  path }` in `meta.ts`, the host composed `/api/<namespace><path>`. */
export type EndpointGroup = Readonly<Record<string, ResolvedRoute>>;

/** Host-shared groups (`files`, `imageStore`, `mcpTools`, `wiki`,
 *  `roles`, `image`) that carry plain string URLs rather than the
 *  plugin `{ method, url }` shape. Kept around so the same registry
 *  can host both plugin-owned routes and the cross-cutting host
 *  endpoints plugins reach for. */
export type HostEndpointGroup = Readonly<Record<string, string>>;

/** The full registry of plugin endpoint groups, keyed by scope
 *  name (`"todos"`, `"wiki"`, `"mulmoScript"`, …). Values are either
 *  plugin-owned `EndpointGroup` records or host-owned
 *  `HostEndpointGroup` records — `pluginEndpoints<E>` narrows to the
 *  caller-declared shape. */
export type EndpointRegistry = Readonly<Record<string, EndpointGroup | HostEndpointGroup>>;

/** Everything the host hands to plugins at boot. Each field is
 *  read-only — plugins consume, never mutate. */
export interface HostContext {
  /** URL maps for each plugin's API namespace. */
  readonly endpoints: EndpointRegistry;
  /** Built-in role IDs (e.g. `general`, `engineer`). Used by
   *  plugins that start a chat with a specific role. */
  readonly builtinRoleIds: Readonly<Record<string, string>>;
  /** Vue-router page-name constants. Used by plugins that need to
   *  branch on the current page or push a navigation. */
  readonly pageRoutes: Readonly<Record<string, string>>;
  /** Snapshot of every registered plugin's tool name. Used by
   *  manageRoles to populate the role-editor's plugin picker. */
  readonly getAllPluginNames: () => readonly string[];
}

let installedContext: HostContext | null = null;

/** Host calls this once at boot (`src/main.ts`) BEFORE component
 *  setup runs. Calling it twice replaces the prior context — useful
 *  for tests; production should install exactly once. */
export function installHostContext(context: HostContext): void {
  installedContext = context;
}

/** Strict reader — throws if the host hasn't installed yet. The
 *  intent is fail-fast: a plugin invoked before install is a wiring
 *  bug, not a state we want to silently paper over. */
function requireContext(): HostContext {
  if (installedContext === null) {
    throw new Error("Plugin host context not installed. Call installHostContext(...) at app boot before mounting any plugin component.");
  }
  return installedContext;
}

/** Returns the URL group for a plugin's scope. The generic `E` lets
 *  the caller declare the expected shape — plugins typically pass
 *  their own typed interface so member access is type-checked
 *  (`pluginEndpoints<TodoEndpoints>("todos").create.url`).
 *
 *  Constraint is `object` (not `EndpointGroup` /
 *  `HostEndpointGroup`) so plugin-owned `Record<string, ResolvedRoute>`
 *  shapes AND host-shared `Record<string, string>` shapes both
 *  satisfy it — `pluginEndpoints` is the indirection that lets a
 *  caller assert the contract it expects. */
export function pluginEndpoints<E extends object = EndpointGroup>(scope: string): E {
  const { endpoints } = requireContext();
  // Own-property check: a scope like "constructor" would otherwise return
  // an inherited `Object.prototype` member instead of throwing.
  const group = Object.prototype.hasOwnProperty.call(endpoints, scope) ? endpoints[scope] : undefined;
  if (!group) {
    throw new Error(`Unknown plugin endpoint scope: "${scope}"`);
  }
  return group as E;
}

/** Built-in role IDs (e.g. `pluginBuiltinRoleIds().general`). */
export function pluginBuiltinRoleIds(): Readonly<Record<string, string>> {
  return requireContext().builtinRoleIds;
}

/** A specific Vue-router page-name constant
 *  (`pluginPageRoute("wiki")`). Throws on unknown name. */
export function pluginPageRoute(name: string): string {
  const { pageRoutes } = requireContext();
  const route = Object.prototype.hasOwnProperty.call(pageRoutes, name) ? pageRoutes[name] : undefined;
  if (!route) {
    throw new Error(`Unknown page route: "${name}"`);
  }
  return route;
}

/** Snapshot of every registered plugin's tool name. */
export function pluginAllPluginNames(): readonly string[] {
  return requireContext().getAllPluginNames();
}
