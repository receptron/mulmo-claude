# presentMulmoScript: load-by-path + background movie generation

## Goal

Extend the `presentMulmoScript` tool so it can:

1. **Re-display an already-saved MulmoScript** by passing a file path (instead of always resending the full JSON), and
2. **Optionally start movie generation in the background** when the tool is invoked, so the user does not have to open the canvas view to kick it off.

Both are **opt-in additions** — existing call sites that pass a full `script` object continue to work unchanged.

## Tool arguments — the full picture

The current tool takes `{ script, filename? }`. The new shape adds two optional fields and turns `script` itself into "optional but required when `filePath` is absent":

| Arg | Type | Required | Meaning |
|---|---|---|---|
| `script` | `object` (MulmoScript JSON) | one of `script` / `filePath` | Full script JSON. Use when **creating a new** presentation. Server saves it to disk and returns `{ script, filePath }`. |
| `filePath` | `string` | one of `script` / `filePath` | Workspace-relative path to an existing MulmoScript JSON file under `stories/` (e.g. `stories/the-life-of-a-star-1700000000000.json`). Use when **re-displaying** a previously created presentation. Server reads + validates the file and returns `{ script, filePath }`. |
| `filename` | `string` | optional | Only meaningful with `script`. Defaults to a slug of the title. Ignored when `filePath` is given. Slugified server-side (drops `/`, `\`, `..`, etc.) so a hostile value cannot escape `stories/`. |
| `autoGenerateMovie` | `boolean` | optional, **default `false`** | When `true`, the server kicks off movie generation in the background after save / load. The user does not need to open the view; progress is tracked through the existing `pendingGenerations` channel. |

### "exactly one of script / filePath"

JSON Schema cannot cleanly express "exactly one of these two optional fields", so the contract is enforced in two places:

- **Tool description** spells out the rule plainly (Claude is the primary enforcer).
- **Server endpoint** validates the request and rejects with a clear error if both or neither are present.

### Four canonical invocations

```jsonc
// 1. Create + present (current behaviour, unchanged)
{ "script": { "$mulmocast": { "version": "1.1" }, "title": "...", ... } }

// 2. Re-display an existing script
{ "filePath": "stories/the-life-of-a-star-1700000000000.json" }

// 3. Re-display AND start movie generation in the background
{
  "filePath": "stories/the-life-of-a-star-1700000000000.json",
  "autoGenerateMovie": true
}

// 4. Create + present + start movie generation in the background
{
  "script": { ... },
  "autoGenerateMovie": true
}
```

## Implementation

### One unified endpoint, server-side dispatch

The tool routes to a **single REST endpoint** — `POST /api/mulmo-script` (the existing `mulmoScript.save`). The server inspects the body and dispatches between two helpers:

- `saveScriptToDisk(script, filename)` — schema-validates the incoming script, slugifies the optional filename to neutralize path-traversal, writes via `writeJsonAtomic`, and realpath-resolves the resulting path.
- `loadScriptFromDisk(filePath)` — enforces `.json` extension, runs `resolveStoryPath` (realpath-based confinement to `stories/`), reads the file, validates against `mulmoScriptSchema`, and returns `toStoryRef(absolute)` as the canonical wire form.

Both helpers return the same `ScriptOutcome` shape (`{ script, wireFilePath, absoluteFilePath, message }`), so the route's tail end (response shaping + `autoGenerateMovie` trigger) is shared.

**Why one endpoint instead of two**: the agent (MCP) layer routes tool calls directly to the REST endpoint listed in `server/agent/plugin-names.ts:TOOL_ENDPOINTS` — bypassing the frontend plugin's `execute()`. Per-mode dispatch on the client would silently no-op on the agent path. Centralizing the branch on the server keeps both call sites in sync.

### `filePath` mode — safety guards

When `filePath` is supplied, before the file is read:

1. Reject anything whose extension is not `.json`.
2. Pass through `resolveStoryPath` which: rejects absolute paths, resolves against the realpath of the stories dir, and rejects results that escape via symlink.
3. Read, `JSON.parse`, validate against `mulmoScriptSchema`. Return `{ script, filePath }` on success; structured error otherwise.
4. Canonicalize the returned `filePath` via `toStoryRef(absoluteFilePath)` so `bar.json` and `stories/foo/../bar.json` collapse to the same `stories/<rel>` key — `pendingGenerations` and movie-status lookups depend on that stability.

### `autoGenerateMovie` — background generation

When `autoGenerateMovie === true`, the route calls `triggerAutoBackgroundMovie(absoluteFilePath, wireFilePath, chatSessionId)` in-process — **no separate REST endpoint**. The trigger:

- Checks the module-level `inFlightMovies` set keyed by realpath; bails if a movie is already running for this script.
- Otherwise marks the script in-flight and fires `runBackgroundMovieGeneration(...)` as a `void`-awaited Promise (response returns immediately).
- The background function uses the same `runMovieGeneration()` core that the SSE `generateMovie` route uses, so behavior stays identical across foreground / background.
- Per-beat completion is mirrored through the session `pendingGenerations` channel (start + finish on `setImmediate`) so the View's existing watcher reloads each artifact off disk without any View changes.
- Terminal error persists a `<filename>.error.txt` sidecar next to the script — there is no synchronous client to alert. Stale sidecars are cleared on the next attempt.

`chatSessionId` is read from the MCP-injected `?session=` query (`getSessionQuery(req)`); when absent (e.g. a GUI call), `publishGeneration` no-ops cleanly.

## Frontend changes

### Tool plugin (`src/plugins/presentMulmoScript/index.ts`)

`execute()` is a one-line `apiPost` pass-through to `mulmoScript.save`. **All dispatch lives on the server.** A doc warning on `src/tools/types.ts:ToolPlugin` calls out that `execute()` is not invoked at runtime in MulmoClaude (the agent path bypasses it via MCP), so future authors don't relapse into client-side branching.

### View (`src/plugins/presentMulmoScript/View.vue`)

**No changes required.** The View consumes `{ script, filePath }` and the existing `pendingGenerations` watcher handles the case where movie generation is already in flight when the view mounts. Spinners and final reload are automatic.

## Tool description update

The `description` field in `definition.ts` gains a short section above the existing JSON schema explaining:

- "Pass `script` to create-and-present a new MulmoScript."
- "Pass `filePath` (workspace-relative path to an existing `stories/*.json`) to re-display an already-saved script — much cheaper than re-sending the whole JSON."
- "Set `autoGenerateMovie: true` only when the user has explicitly asked for the movie. Movie generation is expensive (multiple image + audio API calls + video encoding); never default it on."

## Out of scope (for this plan)

- Listing / browsing saved MulmoScripts in the UI (a separate "open recent" affordance) — Claude can already locate paths via the file tools.
- Per-script error inboxes — the sidecar `.error.txt` is the v1 surface for background failures.
- Resuming a partially-completed background movie generation across server restarts.

## Known limitations

- **`addSessionProgressCallback` is global**: when two movie generations run concurrently for *different* scripts, beats lacking explicit `id`s fall back to `__index__${index}` — and the same fallback id across scripts confuses the per-callback `idToIndex` filter, so progress meant for script A can flip spinners on script B. Fixing this properly needs mulmocast to attach a per-run identifier to its progress events (or a global serialization gate). Pre-existing behavior; not addressed here.

## Risks & open questions

- **Error UX for background failures**: surface the sidecar file's existence somehow (badge in the view header? toast on next session activity?) — confirm with the user before settling.
- **Concurrent multi-script movie gen**: see "Known limitations" above.
