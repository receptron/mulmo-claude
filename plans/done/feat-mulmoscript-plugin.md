# Share presentMulmoScript with MulmoTerminal (`@mulmoclaude/mulmoscript-plugin`)

Goal: extract `presentMulmoScript` into a shared `@mulmoclaude/mulmoscript-plugin`
npm package so **MulmoTerminal can import it the way it already imports
`@mulmoclaude/{markdown,form,chart,html}-plugin`** (see
`../mulmoterminal/plugins/plugins.json`).

This is the last and largest target of `plans/feat-extract-present-plugins.md`
(x → chart → spreadsheet → mulmoscript). Since that plan was written, the
extraction machinery has fully shipped — `x-plugin`, `chart-plugin`, and
`html-plugin` are extracted and live in MulmoTerminal, and the gap-1 unblock
(generic `files.artifacts` FileOps on gui-chat-protocol) is proven in
production by chart + html. What made mulmoscript "do last" was **gap 2**:
heavy backends (mulmocast AI image/audio/movie gen, ffmpeg, headless-Chrome
PDF) that are not generic runtime primitives.

## Source inventory

- Frontend built-in: `src/plugins/presentMulmoScript/` (~2,400 LOC; View.vue
  alone 1,949) — per-beat storyboard editor, deck-editor mode
  (`@mulmocast/deck-web`), character images, movie/PDF generation UI.
- Server: `server/api/routes/mulmo-script.ts` (~1,170 LOC, 18 routes) +
  `server/api/routes/mulmoScriptValidate.ts` (pure zod body validators).
- Tool definition: `src/plugins/presentMulmoScript/definition.ts` (~120 LOC,
  the full MulmoScript authoring prompt).

## Route taxonomy — what is generic vs. host-backed

| Slice | Routes | Backend needed | Phase |
|---|---|---|---|
| Save / reopen / edit | `save`, `update-beat`, `update-script` | `files.artifacts` + zod only | **1 (this PR)** |
| Asset probes | `beat-image`, `beat-audio`, `beat-movie`, `character-image`, `movie-status`, `pdf-status` | mulmocast context (path derivation) | host-side until gap 2 |
| Uploads | `upload-beat-image`, `upload-character-image` | mulmocast context + binary write | host-side until gap 2 |
| Generation | `render-beat`, `generate-beat-audio`, `render-character`, `generate-movie` (SSE), `generate-pdf` (SSE) | mulmocast + ffmpeg + provider keys + progress channel | host-side until gap 2 |
| Downloads | `download-movie`, `download-pdf` | binary `res.download` | host-side until gap 2 |

## Gap-2 resolution (decided)

`mulmocast` is plain npm, and it shells out to ffmpeg itself — so the package's
server entry MAY depend on mulmocast directly in a later phase; no sanctioned
generic `exec` primitive is needed. What stays host-provided (injected or kept
in thin host routes):

- **ffmpeg availability probing** — MulmoClaude: `depStatus("ffmpeg")` (#1385);
  MulmoTerminal: its own probe or a plain 503 guard.
- **Generation-progress fan-out** — MulmoClaude's `publishGeneration` /
  session-store is host-specific. The generic replacement is the plugin
  `pubsub` channel (the html-plugin View's live-refresh precedent).
- **Provider API keys** (Gemini TTS, Google image/movie) — host environment.
- **SSE / binary routes** — don't fit MulmoTerminal's JSON
  `/api/plugin/:toolName` dispatch envelope; MulmoTerminal registers dedicated
  express routes for them (same pattern as its `spawnBackgroundChat` /
  `manageCollection` pre-catch-all specials).

## Phase 1 — server core (this PR)

Server-only package (`.` entry only; template = x-plugin's build, html-plugin's
core layout), **browser-safe** (no Node built-ins, like chart/html cores) so
the host's client-side definition shim can import from `.`:

```
packages/plugins/mulmoscript-plugin/
  src/core/
    definition.ts   TOOL_NAME + TOOL_DEFINITION (moved verbatim from host)
    types.ts        SaveMulmoScriptArgs, MulmoScriptData, MulmoScriptExecuteContext
    paths.ts        slugify (simple, html-plugin style), storyFilePath, normalizeStoryPath
    validate.ts     validateUpdateBeatBody / validateUpdateScriptBody (moved verbatim
                    from server/api/routes/mulmoScriptValidate.ts)
    plugin.ts       executeMulmoScriptSave / executeUpdateBeat / executeUpdateScript
                    (discriminated outcomes with bad_request|not_found codes so hosts
                    keep their 400-vs-404 wire contract) + executeMulmoScript
                    (ToolResult wrapper) + pluginCore (ToolPluginCore for
                    MulmoTerminal's package loader)
  test/             validator tests (moved from test/routes/test_mulmoScriptValidate.ts)
                    + paths + execute tests against a fake FileOps
```

Path model: the stories dir is `artifacts/stories` (`WORKSPACE_PATHS.stories`),
and the FileOps root is `<workspace>/artifacts` — so the FileOps-relative path
and the historical `stories/<name>.json` wire form are the **same string**.

Host becomes a consumer:

- `src/plugins/presentMulmoScript/definition.ts` → thin shim re-exporting
  `TOOL_DEFINITION` (chart-shim shape; `meta.ts`, View, index stay untouched).
- `server/api/routes/mulmo-script.ts` → `save` / `update-beat` / `update-script`
  handlers call the package with `makeArtifactsFileOps()`; `autoGenerateMovie`
  trigger stays host-side (resolves the wire path to an absolute realpath for
  the in-flight dedup key). All other handlers unchanged.
- Delete `server/api/routes/mulmoScriptValidate.ts` (moved into the package).
- `packages/mulmoclaude/package.json` gains `"@mulmoclaude/mulmoscript-plugin":
  "^0.1.0"` (launcherSync lockstep). Root needs no edit — `packages/plugins/*`
  is auto-discovered by `build-workspaces.mjs` (tier 4) and workspace-linked.

Accepted behavior deltas (all cosmetic / stricter-input only):

- New-file slugs use the package's simple slugify (html-plugin precedent:
  "deliberately simpler than the host's hash-fallback variant — throwaway
  artifact filenames"). Non-ASCII-only titles now slug to the fallback instead
  of a sha256 fragment. Timestamp suffix keeps names collision-free.
- Wire-path normalization is lexical (reject `..` / `.` / `//` segments)
  instead of realpath-canonicalizing; symlinked spellings of the same file no
  longer collapse for the save/load slice (the movie dedup key still realpaths
  host-side).

## Phase 2 — Vue extraction (DONE — same branch as phase 1)

`./vue` + `./style.css` entries shipped; the View/Preview moved into the
package and the host became a consumer. The transport redesign:

- **Dispatch envelope** (`core/contract.ts`): every backend call goes through
  `useRuntime().dispatch({ kind, … })` → the built-in "mulmoScript" handler
  (`server/plugins/mulmoscript-builtin.ts`). Responses are `{ ok: … }`
  envelopes so business failures travel as data (no HTTP-status coupling).
- **One implementation per op** (`server/api/routes/mulmo-script-ops.ts`):
  the REST handlers' bodies were extracted into transport-free cores shared
  by BOTH the legacy REST routes (kept for wire compat, incl. the SSE
  streams) and the dispatch handler — no drift surface.
- **SSE → long-held dispatch + pubsub**: `generateMovie` / `generatePdf`
  dispatches resolve when the pipeline finishes; per-beat progress arrives on
  the plugin pubsub channel `plugin:mulmoScript:generation`
  (`server/events/mulmoscript-generation.ts` fans every generation
  start/finish out to the session `pendingGenerations` channel AND the
  plugin channel, and keeps the in-flight map behind the View's mount-time
  `pendingGenerations` snapshot dispatch). This replaced BOTH the SSE stream
  and the host-only `useActiveSession().pendingGenerations` watcher.
- **Host adapter injection** (`vue/hostAdapter.ts`): the two genuinely
  host-transport capabilities ride an optional Vue injection —
  `chatSessionId` (session tagging for the sidebar indicator) and
  `fetchMediaBlob` (bearer-authenticated movie/PDF bytes; download/clip-play
  UI hides when absent). MulmoClaude provides both in
  `src/plugins/presentMulmoScript/index.ts`; MulmoTerminal wires its own in
  phase 3.
- i18n moved into package `lang/` (8 locales, html-plugin `useT()` pattern);
  the `pluginMulmoScript` blocks left the host locale files.
- e2e mock fixtures now stub the dispatch URL
  (`/api/plugins/runtime/mulmoScript/dispatch`) with kind-discriminated
  route mocks.

## Phase 3a — ops into the package's `./server` entry (DONE)

The entire ops layer (probes, renders, uploads, movie/PDF pipelines,
generation tracker, dispatch router, `mulmoErrorCapture`, realpath
containment) moved into `@mulmoclaude/mulmoscript-plugin/server` — a
Node-only entry with `mulmocast` + `graphai` as peers. Host-specific
transport is injected via `MulmoScriptServerBackend`: stories dir,
artifacts FileOps, hardened atomic write, ffmpeg probe, logger, and the
edge-triggered `onGenerationEvent` fan-out. MulmoClaude's binding lives in
`server/plugins/mulmoscript-server.ts` (creates the instance, registers
the built-in dispatch via the package's `createMulmoScriptDispatchHandler`,
wires the pubsub publisher); the REST routes consume the same instance.
`mulmo-script-ops.ts`, `mulmoscript-builtin.ts`,
`events/mulmoscript-generation.ts`, and `utils/mulmoErrorCapture.ts` were
deleted from the host.

## Phase 3b — MulmoTerminal wiring (follow-up PR, other repo)
- MulmoTerminal: add to `plugins.json` `packages`, a `server/backends/
  mulmoscript.ts` (like its `html.ts`, plus dedicated SSE/binary routes),
  mulmocast + ffmpeg + provider keys in its environment.
- Realpath symlink containment (Codex P1 on #2133) is satisfied for free
  by phase 3a: the package's dispatch handler guards the save/reopen/update
  kinds with the instance's realpath-based `guardStoryWirePath` — any host
  that registers `createMulmoScriptDispatchHandler` inherits it. A host
  adding its OWN routes over the phase-1 core executes must still apply the
  guard itself.

## Publish

`@mulmoclaude/mulmoscript-plugin@0.1.0` — bump in the PR, publish after merge
on explicit ask (tag `@mulmoclaude/mulmoscript-plugin@0.1.0`, GH release
`--latest=false`, `/publish` skill).
