# refactor(mulmo-script): fold the duplicated beat-op handler skeleton

Issue: #2368

## Problem

`server/api/routes/mulmo-script.ts` had two handlers — `generateBeatAudio` and
`renderBeat` — that repeated the same eight lines:

```ts
const { filePath, beatIndex, force, chatSessionId } = req.body;
if (typeof filePath !== "string" || !filePath || !validBeatIndex(beatIndex)) {
  badRequest(res, "filePath and beatIndex are required");
  return;
}
const result = await mulmoScriptOps.<op>({ filePath, beatIndex, force, chatSessionId });
if (!result.ok) {
  sendOpFailure(res, result);
  return;
}
res.json({ <audio|image>: result.<audio|image> });
```

Only the op and the success key differ. `validBeatIndex` guards an array
index, so every copy of this skeleton is a place the guard can be dropped
when the next beat endpoint (caption, subtitle, …) is written.

## Approach

1. **Pin `validBeatIndex` first.** Its accept/reject matrix (0, `-0`, negative,
   non-integer, `NaN`, infinities, numeric strings, `undefined`/`null`, other
   types, no upper bound) goes into tests BEFORE the guard moves, so a
   widened or narrowed condition fails loudly.
2. Extract `server/api/routes/mulmoScriptBeatOp.ts` holding
   `validBeatIndex`, `sendOpFailure` + its status table, `ErrorResponse`, and
   the new `makeBeatOpHandler` factory. A separate module keeps the guard
   testable without importing `server/plugins/mulmoscript-server.ts` (which
   boots the whole plugin runtime).
3. `makeBeatOpHandler(runOp, toResponse)` returns the Express handler.
   `runOp` is generic over its success result; `toResponse` names the one
   response key. No `any`, no `as`, validation and failure mapping shared.
4. Each endpoint becomes a `bindRoute(router, route, makeBeatOpHandler(op, map))`
   declaration.

The error string `"filePath and beatIndex are required"` is unchanged.

## Which handlers fold, which don't

Folded (identical shape — body-carried `{ filePath, beatIndex, force, chatSessionId }`,
object-arg op, single-key 200):

- `generateBeatAudio` → `generateBeatAudioOp`, key `audio`
- `renderBeat` → `renderBeatOp`, key `image`

Left alone, with reasons:

- `beatImage` / `beatAudio` / `beatMovie` — **GET, query-string input.** They
  read `req.query`, must turn a string into a number before the index check,
  and call positional ops `(filePath, beatIndex)`. Their validation is
  already shared through `parseBeatQuery`, which is the part that carries the
  index-guard risk; the remaining four lines are not the same shape as the
  POST bodies and folding them would mean a second parse mode inside the
  factory.
- `uploadBeatImage` — POST and beat-scoped, but requires a third field
  (`imageData`), responds with a **different** error message
  (`"filePath, beatIndex, and imageData are required"`), and calls a
  positional op. Bending it into the shared shape would either change its
  wire error text or add a variadic-field escape hatch to the factory.
- `renderCharacter` / `uploadCharacterImage` / `characterImage` — keyed by
  `key`, not `beatIndex`; no array index involved.

## Tests

`test/server/api/test_mulmoScriptBeatOp.ts` (node:test), with an injected
fake op — no real generation:

- `validBeatIndex` full matrix, including the deliberate absence of an upper
  bound (the beat count is only known after the op loads the script).
- `sendOpFailure` status table (400 / 404 / 503 / 500).
- Handler validation: empty / missing / non-string `filePath`, missing /
  negative / non-integer / numeric-string / `NaN` / boolean `beatIndex`,
  empty body — each a 400 with the unchanged message and **no op call**.
- `beatIndex: 0` accepted (regression guard against a falsy check).
- Op failure routes through `sendOpFailure` for every code.
- Each endpoint's own success key (`audio` vs `image`), `force` /
  `chatSessionId` forwarded.

Mutation check: deleting the `!filePath` emptiness clause must turn the
empty-string test red.
