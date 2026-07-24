# feat — optional OpenAI provider for `generateImage`, engine shared via core

Today `generateImage` is hardwired to Gemini: the MCP tool binds to
`/api/image/generate-image` (`src/plugins/_extras.ts:56`), whose route
(`server/api/routes/image.ts:105`) calls
`generateGeminiImageFromPrompt` in host-only `server/utils/gemini.ts`
(`GEMINI_API_KEY`, default model `gemini-3.1-flash-image-preview`,
16:9). Make the provider selectable so a user can opt into OpenAI's
image generation; Gemini stays the default.

**Portability requirement**: MulmoTerminal must be able to adopt this
with a dep bump + thin wiring, so the provider engine lives in
`@mulmoclaude/core`, NOT in `server/utils/` — the same "shared
cross-host server code goes in core via a subpath export" rule the
collection engine follows. Today `server/utils/gemini.ts` is invisible
to MulmoTerminal; moving it is the point.

## New core subpath: `@mulmoclaude/core/image-generation` (server-only)

`packages/core/src/image-generation/`:

- `types.ts` — `ImageGenResult { imageData?: string; message?: string }`
  (the current `GeminiImageResult`, renamed provider-neutral),
  `ImageProvider = "gemini" | "openai"`, and:

  ```ts
  interface ImageGenConfig {
    geminiApiKey?: string;
    openaiApiKey?: string;
    provider?: string;         // raw env value; resolver validates
    openaiImageModel?: string; // default "gpt-image-1"
    log?: ImageGenLogger;      // CollectionLogger shape; default no-op
  }
  ```

  Core reads NO `process.env` — each host builds the config from its
  own env once. Explicit params (not a `configure`-once global): only
  two call sites exist, and a param keeps the module trivially
  portable/testable.
- `gemini.ts` — `server/utils/gemini.ts` moved verbatim minus env/log
  coupling: `getGeminiClient(apiKey)`, the pure extractors
  (`firstCandidateParts`, `firstFinishReason`, `extractImageResult`),
  `generateGeminiImageContent`, `generateGeminiImageFromPrompt` — key
  and logger now from `ImageGenConfig`.
- `openai.ts` — new client, plain `fetch` to
  `https://api.openai.com/v1/images/generations` (no `openai` SDK for
  one endpoint): `AbortController` with a module-owned
  `IMAGE_GENERATION_TIMEOUT_MS = 2 * 60_000` named constant,
  `!response.ok` → throw with `body.error.message`, request
  `{ model, prompt, size: "1536x1024" }` (landscape ≈ the Gemini
  path's 16:9), response `data[0].b64_json` → `imageData`,
  `data[0].revised_prompt` → `message`. Pure extractor exported for
  tests, mirroring `extractImageResult`.
- `provider.ts` —
  `resolveImageProvider(config, geminiOk, openaiOk): ImageProvider`
  (pure): explicit `provider` wins even if its key is missing (the
  call then fails with a clear "…_API_KEY is not set", mirroring
  today's `getGeminiClient`); unset → `gemini` when available, else
  `openai` when available, else `gemini` (preserves today's error
  path). Plus the dispatcher
  `generateImageFromPrompt(config, prompt, model?): Promise<ImageGenResult>`.

Packaging: new `./image-generation` entry in core's `exports` map with
`types` / `import` / `require` / `default` conditions (Docker CJS
rule), server-only (not in any browser-safe surface). `@google/genai`
moves from the host `package.json` to core's `dependencies` — the
host's `server/utils/gemini.ts` is its ONLY importer today, so the
host declaration is removed with the move.

## MulmoClaude host wiring

- `server/system/env.ts` — new entries `openaiApiKey`
  (`OPENAI_API_KEY`), `imageProvider` (`MULMOCLAUDE_IMAGE_PROVIDER`),
  `openaiImageModel` (`MULMOCLAUDE_OPENAI_IMAGE_MODEL`), plus
  `isOpenAIImageAvailable()`. New `imageGenConfig()` helper assembling
  the core `ImageGenConfig` from env + the host logger.
- `server/api/routes/image.ts` — `/generate-image` calls the core
  dispatcher; `/edit-image` calls the moved
  `generateGeminiImageContent` (unchanged behavior, new import).
  Resolved provider added to `generate: start` / `ok` / error logs.
  Everything downstream (`respondWithImage`, `saveImage`, canvas) is
  already provider-agnostic base64 — untouched.
- `server/utils/files/markdown-image-fill.ts` — the only other
  consumer; import path swap (stays Gemini-only, see non-goals).
- `server/utils/gemini.ts` — deleted (both consumers migrated).
- `server/system/announceGeminiKey.ts` — when `GEMINI_API_KEY` is
  missing but the OpenAI provider is active, the blanket "image /
  audio / video generation is unavailable" warning is wrong about
  images: log that image generation uses OpenAI and warn only about
  audio / video (movie beats stay Gemini).
- `/api/health` `geminiAvailable` + SidebarHeader hint stay as-is
  (Gemini absence still governs audio/video). No client change.

## MulmoTerminal adoption (the payoff — document, don't implement here)

Everything provider-shaped ships in core; MulmoTerminal's port is thin
and additive (no engine-contract change, so no lockstep port needed —
it adopts on its own schedule):

1. bump `@mulmoclaude/core` dep;
2. build an `ImageGenConfig` from ITS env + logger;
3. wire its own route/backend to `generateImageFromPrompt` and its own
   save-to-workspace step (image storage stays host-owned by design —
   MulmoClaude's `saveImage` shards under `artifacts/images/YYYY/MM`,
   and MulmoTerminal shares that workspace layout).

Note this adoption recipe in the PR description for the MulmoTerminal
side.

## Error-recovery know-how

Add a section to `packages/core/assets/helps/error-recovery.md` (per
the CLAUDE.md rule): `generateImage` failures — which provider is
active (`MULMOCLAUDE_IMAGE_PROVIDER`), which key each provider needs,
and that an explicit provider with a missing key fails per-call.

## Files

- `packages/core/src/image-generation/{types,gemini,openai,provider}.ts`
  + `index.ts` — new subpath (gemini.ts moved from host).
- `packages/core/package.json` — `./image-generation` exports entry,
  `@google/genai` dependency, version `0.29.0` → `0.30.0` (new
  subpath + moved module + help asset). Launcher dep-range lockstep in
  `packages/mulmoclaude/package.json`; no plugin range ratchet.
  Collision note: `plans/done/fix-backlinks-table-nested-via.md` also
  targets `0.30.0` — whichever PR lands second rebases to `0.31.0`.
- `packages/core/assets/helps/error-recovery.md` — new section.
- `server/system/env.ts` — env entries + `imageGenConfig()`.
- `server/api/routes/image.ts`, `server/utils/files/markdown-image-fill.ts`
  — import swaps; provider in route logs.
- `server/utils/gemini.ts` — deleted.
- `server/system/announceGeminiKey.ts` — OpenAI-aware boot message.
- `.env.example` / `README.md` — document the three new vars next to
  the existing `GEMINI_API_KEY` guidance.
- `docs/shared-utils.md` — entry pointing at
  `@mulmoclaude/core/image-generation` (same-PR rule).
- Tests: move/extend the existing pure gemini-extractor tests and add
  resolver truth-table + OpenAI extractor tests under
  `packages/core/test/image-generation/`; no live-API tests.

## Non-goals

- `editImages` stays Gemini (OpenAI images/edits parity is separate
  work) — but it now calls the CORE gemini module, so a later port
  inherits the move.
- Wiki `markdown-image-fill.ts` and movie/audio/video stay Gemini.
  The dispatcher is deliberately reusable if we widen later.
- No per-call provider argument on the tool; selection is
  deployment-level env config. No UI/settings surface for keys.
- No MulmoTerminal changes in this PR (recipe above).

## Verification

- `yarn test` — moved extractor tests + new resolver/OpenAI tests
  green; clear local eslint/tsc caches before pushing (moved files).
- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` green
  (build proves the new subpath resolves in both import/require).
- Manual: (1) only `GEMINI_API_KEY` → unchanged behavior, including
  `/edit-image` and wiki image-fill; (2)
  `MULMOCLAUDE_IMAGE_PROVIDER=openai` + `OPENAI_API_KEY` → image
  generated via OpenAI, saved under `artifacts/images/`, canvas
  renders it; (3) `openai` forced with no key → per-call error
  surfaced to the agent; (4) only `OPENAI_API_KEY` set → images work,
  boot line says audio/video unavailable.
