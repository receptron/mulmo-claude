// Shared `execute()` factory for built-in plugins that pass straight
// through to one host REST route.
//
// The tool-result assembly convention — failure returns
// `{ toolName, uuid, message }`, success spreads the server body and
// stamps a fresh `toolName` / `uuid` — used to be hand-copied into
// every plugin's `index.ts` (#2335). It lives here now, so changing
// the convention is a one-file edit.
//
// Two entry points because the host exposes two endpoint shapes:
// plugin-owned groups carry `{ method, url }` (`makeRouteExecute`),
// host-shared groups carry bare URL strings (`makePostExecute`).
//
// Not every plugin fits: `manageSkills` reshapes the response and
// decorates the failure message, `presentHtml` injects a host-served
// preview URL into `data`. Those keep their own bodies.

import type { ToolResult } from "gui-chat-protocol";
import { pluginEndpoints } from "./api";
import type { ResolvedRoute } from "./meta-types";
import { apiCall } from "../utils/api";
import { makeUuid } from "../utils/id";

/** What gui-chat-protocol's `ToolPlugin.execute` accepts. `unknown`
 *  parameters are supertypes of its `ToolContext` / `object`, which is
 *  what makes this assignable under `strictFunctionTypes` — no cast. */
export type PluginExecute<D> = (context: unknown, args: unknown) => Promise<ToolResult<D>>;

/** A plugin-owned endpoint group (`{ create: { method, url } }`). */
type RouteGroup = Readonly<Record<string, ResolvedRoute>>;

/** A host-shared endpoint group carrying bare URLs (`image`, `roles`). */
type UrlGroup = Readonly<Record<string, string>>;

async function callRoute<D>(route: ResolvedRoute, toolName: string, args: unknown): Promise<ToolResult<D>> {
  const result = await apiCall<ToolResult<D>>(route.url, { method: route.method, body: args });
  if (!result.ok) {
    return { toolName, uuid: makeUuid(), message: result.error };
  }
  return { ...result.data, toolName, uuid: makeUuid() };
}

/** Pass-through executor over a plugin-owned route.
 *
 *  The endpoint group is read inside the returned closure, not here —
 *  the host installs its context (`installHostContext`) after plugin
 *  modules load, so resolving eagerly would throw at import time.
 *
 *  `async` so an unresolvable scope surfaces as a rejected promise,
 *  matching the hand-written `async execute()` bodies this replaces —
 *  a sync throw would escape a caller's `.catch()`. */
export function makeRouteExecute<E extends RouteGroup, D>(scope: string, routeKey: keyof E & string, toolName: string): PluginExecute<D> {
  return async (_context, args) => callRoute<D>(pluginEndpoints<E>(scope)[routeKey], toolName, args);
}

/** Pass-through executor over a host-shared group whose entries are
 *  bare URLs. `POST` because that is the only method those groups are
 *  reached with (`apiPost` is `apiCall` with `method: "POST"`). */
export function makePostExecute<E extends UrlGroup, D>(scope: string, urlKey: keyof E & string, toolName: string): PluginExecute<D> {
  return async (_context, args) => callRoute<D>({ method: "POST", url: pluginEndpoints<E>(scope)[urlKey] }, toolName, args);
}
