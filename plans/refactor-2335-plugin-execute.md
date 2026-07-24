# refactor(plugins): extract the shared endpoint-dispatch `execute()` — #2335

## Problem

11 built-in frontend plugins hand-copy the same `execute()` body: resolve the
plugin's endpoint group through `pluginEndpoints`, issue one `apiCall` /
`apiPost`, return `{ toolName, uuid, message: result.error }` on failure and
`{ ...result.data, toolName, uuid }` on success.

The tool-result assembly convention (what a failure looks like, where `uuid`
comes from) therefore lives in 11 places. Changing it means editing 11 files
and silently breaking whichever one is missed.

## Survey — what is actually identical

Read all 11 before collapsing any. Three groups emerged.

**Group A — `apiCall` over a `{ method, url }` route (6 plugins, byte-identical
modulo scope / route key / data type):**

| plugin | scope | route key |
| --- | --- | --- |
| `canvas` | `canvas` | `dispatch` |
| `chart` | `chart` | `create` |
| `markdown` | `markdown` | `create` |
| `presentMulmoScript` | `mulmoScript` | `save` |
| `presentSVG` | `svg` | `create` |
| `spreadsheet` | `spreadsheet` | `create` |

**Group B — `apiPost` over a host-shared bare-URL group (3 plugins,
byte-identical to each other):**

| plugin | scope | url key |
| --- | --- | --- |
| `editImages` | `image` | `edit` |
| `generateImage` | `image` | `generate` |
| `manageRoles` | `roles` | `manage` |

`apiPost(path, body)` is defined as `apiCall(path, { method: "POST", body })`,
so Group B is Group A with the method fixed to `POST`.

**Not folded — genuinely different:**

- `manageSkills` — `apiGet`, no `body`, prefixes the failure message
  (`Failed to load skills: …`), sets an extra `error` field on failure, and
  builds `title` / `message` / `data` itself from the response rather than
  spreading it.
- `presentHtml` — on success it rewrites `data` to inject the host-served
  `previewUrl` before spreading. Host-specific transform, not a pass-through.

## Design

New file `src/plugins/execute.ts` — sits next to the existing plugin-side
infrastructure (`api.ts` = endpoint DI, `scope.ts` = component wrapper,
`meta-types.ts` = route shapes).

```ts
export type PluginExecute<D> = (context: unknown, args: unknown) => Promise<ToolResult<D>>;

export const makeRouteExecute = <E extends RouteGroup, D>(scope, routeKey: keyof E & string, toolName): PluginExecute<D>
export const makePostExecute  = <E extends UrlGroup,   D>(scope, urlKey:   keyof E & string, toolName): PluginExecute<D>
```

Both delegate to one private `runRoute` that owns the result assembly.

Constraints honoured:

- **No new `as` casts.** `E` is constrained to `Readonly<Record<string, ResolvedRoute>>`
  (or `Readonly<Record<string, string>>`), so `pluginEndpoints<E>(scope)[key]`
  is already typed — no assertion needed. The pre-existing
  `as unknown as Component` on `viewComponent` / `previewComponent` is left
  untouched (out of scope).
- **Contravariance.** `context: unknown` / `args: unknown` are supertypes of
  `ToolContext` / `object`, so `PluginExecute<D>` is assignable to
  gui-chat-protocol's `execute` under `strictFunctionTypes` without a cast.
- Endpoints are resolved **inside** the returned closure, not at factory-call
  time — the host installs its context in `src/main.ts` after module load, so
  resolving eagerly would throw at import.

## Steps

1. Add `src/plugins/execute.ts`.
2. Rewrite the 9 folded plugins' `execute` to a single factory call; drop the
   now-unused `pluginEndpoints` / `apiCall` / `apiPost` / `makeUuid` /
   `ToolResult` imports where nothing else uses them.
3. Add `test/plugins/test_execute.ts` (node:test): success spread, failure
   message, per-call fresh uuid, both factories, method/url/body forwarding.
4. Verify the tests are real by breaking the helper and watching them go red.
5. Add the helper to `docs/shared-utils.md` (Plugin Infrastructure table).

## Findings while implementing

**The returned closure must be `async`.** The first draft returned
`(_context, args) => callRoute(pluginEndpoints(scope)[key], …)`. That resolves
the endpoint synchronously, so an unknown scope throws *out of* `execute()`
instead of rejecting its promise — a caller's `.catch()` would miss it, unlike
the `async execute()` bodies being replaced. The "throws on an unknown scope"
test caught it; the factories are `async` now.

**Mutation check** (each applied to `callRoute`, then reverted):

| mutation | result |
| --- | --- |
| failure branch deleted (`return { ...result.data, … }` only) | 4 red |
| `message: result.error` → a constant | 3 red |
| spread order flipped (`{ toolName, uuid, ...result.data }`) | 1 red |
| `makeUuid()` hoisted to a module constant | 2 red |

## Risk

Low. `src/tools/types.ts` documents that MulmoClaude **never calls
`execute()`** — tool calls flow Claude → MCP → the REST route directly. The
function exists to satisfy the gui-chat-protocol `ToolPlugin` shape for other
hosts. So this is a type-level + shape-level change with no production call
path; the new unit test is the only executing coverage, plus `vite build` for
the bundle.
