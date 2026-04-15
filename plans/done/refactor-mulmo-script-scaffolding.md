# refactor: DRY mulmo-script.ts handler scaffolding (#136)

## Context

Issue [#136](https://github.com/receptron/mulmoclaude/issues/136) — server/ DRY audit — has one open hotspot left after PR #145:

> **#1** `routes/mulmo-script.ts` handler scaffolding — 11 nearly-identical handlers all do `validate body → resolveStoryPath → buildContext → try/catch/errorMessage`. 15 of jscpd's 22 clones live here. ~200 lines saved, medium risk.

## Goal

Extract the repeated `resolveStoryPath → buildContext → try/catch/errorMessage` scaffold so each handler contains only its business logic.

## Approach

Add one helper in `server/routes/mulmo-script.ts` (or a sibling file) that wraps the common prologue + error-catch:

```ts
type StoryJsonResponse = { error: string } | Record<string, unknown>;

async function withStoryContext(
  res: Response,
  filePath: string,
  options: { force?: boolean },
  handler: (ctx: {
    absoluteFilePath: string;
    context: MulmoStudioContext;
  }) => Promise<void>,
): Promise<void> {
  const absoluteFilePath = resolveStoryPath(filePath, res);
  if (!absoluteFilePath) return;
  try {
    const context = await buildContext(absoluteFilePath, options.force ?? false);
    if (!context) {
      res.status(500).json({ error: "Failed to initialize mulmo context" });
      return;
    }
    await handler({ absoluteFilePath, context });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
}
```

Handlers shrink from ~30 lines to ~10 lines each.

## Scope

### In scope — apply `withStoryContext` to these 9 handlers

1. `GET /mulmo-script/beat-image`
2. `GET /mulmo-script/beat-audio`
3. `GET /mulmo-script/movie-status` (returns `moviePath: null` instead of 500 when context init fails — preserve by handling inside the callback; easier path: inline it, see below)
4. `POST /mulmo-script/generate-beat-audio` (force-capable)
5. `POST /mulmo-script/render-beat` (force-capable)
6. `POST /mulmo-script/upload-beat-image`
7. `GET /mulmo-script/character-image`
8. `POST /mulmo-script/render-character` (force-capable)
9. `POST /mulmo-script/upload-character-image`

For `movie-status`: the existing code returns `{ moviePath: null }` (not 500) when context is null. Two options:
- (a) pass a per-call `onNoContext` callback,
- (b) leave `movie-status` as-is and only refactor the other 8.

Prefer (b) for simplicity — less branching in the helper.

### Out of scope — left as-is

- `POST /mulmo-script` (save) — no story file exists yet, no context build
- `POST /mulmo-script/update-beat` — synchronous, reads raw JSON, no context build. `loadJsonFile`/`saveJsonFile` from `server/utils/file.ts` are NOT suitable here (their silent-default-on-parse-error behaviour would hide a corrupt file and then overwrite it with the default). Keep direct `fs` usage.
- `POST /mulmo-script/generate-movie` — SSE response, bespoke error/cleanup flow
- `GET /mulmo-script/download-movie` — no context build

## Risk

Medium. Mitigations:

- Keep the helper in the same file — no cross-file surface changes.
- Preserve error-response shapes verbatim: each handler currently returns `{ error: <string> }` on 500, matching `ErrorResponse`.
- Run `yarn test:e2e -- present-mulmo-script.spec.ts` (plus `image-plugins.spec.ts` if it exercises any of these endpoints) before declaring done.
- Run full `yarn format && yarn lint && yarn typecheck && yarn build`.

## Testing

### Unit tests (new)

Extract `withStoryContext` as an **exported, injectable** helper so it can be tested without the full route stack:

```ts
export async function withStoryContext(
  res: Response,
  filePath: string,
  options: { force?: boolean },
  handler: (ctx: { absoluteFilePath: string; context: MulmoStudioContext }) => Promise<void>,
  deps: {
    resolveStoryPath?: typeof resolveStoryPath;
    buildContext?: typeof buildContext;
  } = {},
): Promise<void> { ... }
```

`deps` defaults to the production functions so route code reads cleanly; tests override.

New file `test/routes/test_mulmoScriptHelpers.ts` covers:

- resolver rejects bad filePath → 400 via injected `resolveStoryPath` returning null; handler must NOT run.
- `buildContext` returns null → 500 `{ error: "Failed to initialize mulmo context" }`; handler must NOT run.
- Handler throws → 500 `{ error: <message> }`.
- Happy path → handler invoked with `{ absoluteFilePath, context }`; no error response.

### E2E tests (new)

Extend `e2e/tests/present-mulmo-script.spec.ts`:

1. **"Regenerate beat image" round-trip** — mock `/api/mulmo-script/render-beat` to return `{ image: "data:image/png;base64,iVBOR..." }`, click the regenerate button on a beat, assert the mocked image appears in the View.
2. **"Render beat error surfaces to UI"** — mock the same endpoint to return `{ error: "Image was not generated" }` with status 500, assert the error is shown (or no crash).

The existing tests mock every endpoint with `{}`; these new tests mock specific endpoints with meaningful payloads to exercise the frontend's response handling (which remains unchanged by the refactor but serves as a regression net).

## Non-goals

- No behaviour changes for the production code paths.
- No logger conversions — scope is duplication, not observability.

## Checklist

- [ ] Extract `withStoryContext` helper (exported + injectable)
- [ ] Migrate 8 handlers (skip `movie-status`)
- [ ] New unit tests `test/routes/test_mulmoScriptHelpers.ts` (4 cases)
- [ ] New E2E scenarios in `present-mulmo-script.spec.ts` (2 cases)
- [ ] `yarn format && yarn lint && yarn typecheck && yarn build`
- [ ] `yarn test` (includes new unit tests)
- [ ] `yarn test:e2e -- tests/present-mulmo-script.spec.ts`
- [ ] Push + PR + link to #136
- [ ] After merge: close #136 with summary comment
