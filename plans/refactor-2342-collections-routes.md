# refactor: dedup store-failure → HTTP mapping and view/action resolution in the collections routes

Issue: #2342 — follow-up to #2144 (resolve-or-404 preambles in the same file).

## Context

`server/api/routes/collections.ts` still repeats three shapes that jscpd
flags (#373 / #374 / #366 / #273):

1. **store-failure → HTTP** in item create / update / delete — the same
   `invalid-id` / `path-escape` / `conflict` / `not-found` ladder written
   out three times.
2. **custom-view resolution** — `viewFile` and `viewI18n` both read
   `:slug` + `?id=`, call `resolveCustomViewOr404`, and destructure.
3. **action lookup** — `collection.schema.actions?.find(...)` plus the
   identical `notFound` wording, in the bearer item-action route and the
   view-token action route.

`path-escape` → 403 is a workspace-escape REFUSAL. Hand-written in three
places, one site could be downgraded to a 400 (or dropped) and the other
two would silently keep the old behaviour — exactly the drift a single
site prevents.

## What this does

### `sendStoreFailure(res, failure, { slug, onConflict })`

One mapper over `Exclude<WriteItemResult | DeleteItemResult, { kind: "ok" }>`:

| kind | response |
|---|---|
| `invalid-id` | 400 `invalid item id: <itemId>` |
| `path-escape` | 403 `data directory for collection '<slug>' escapes the workspace` |
| `not-found` | 404 `item '<itemId>' not found` |
| `conflict` + `onConflict: "duplicate"` | 409 `item '<itemId>' already exists` |
| `conflict` + `onConflict: "unreachable"` | 500 `unexpected conflict on update` |

`onConflict` exists because create and update genuinely differ: create
writes with `refuseOverwrite`, so a duplicate id is a real 409; update
never sets the flag, so its `conflict` branch is unreachable and only
survives for exhaustiveness. That WHY moves onto the helper. Delete's
result type carries no `conflict` at all, so it passes `"unreachable"`
too. Every status and message is byte-identical to the code it replaces.

### `resolveViewRequest(req, res)`

`:slug` + `?id=` → `{ collection, view }` or a 404 + `null`. Built from
`stringParam` (new, in `collectionParams.ts` beside the other request
parsers) and `findViewOr404`, which is split out of
`resolveCustomViewOr404` so the "view missing on a real collection" 404
is testable without touching the filesystem.

`stringParam` also replaces the `typeof req.query.x === "string" ? … : ""`
ternary in the `remoteView` route (id + locale) and `viewI18n` (locale) —
same rule, and a repeated `?id=a&id=b` (which arrives as an array) must
keep reading as absent.

### `findActionOr404(collection, actionId, res)`

Record-level action lookup + the shared 404 wording. Twin of
`findViewOr404`. The `collectionActions` lookup keeps its own wording and
its own array, so it stays where it is.

## Deliberately NOT in this PR

- The `collectionActions` lookup (different array, different message).
- `viewToken` / `viewDataAction` body reads (`.trim()`ed, body not query).
- The remote-view / delete-view failure mappers — already single-site.

## Tests

`test/api/routes/test_collectionsStoreFailure.ts` (new): every `kind`
branch of `sendStoreFailure` for both `onConflict` values, an out-of-union
kind (must still answer rather than hang), the exact message strings, plus
`findActionOr404` / `findViewOr404` happy path + missing + absent-array.
`stringParam` cases go in the existing `test_collectionParams.ts`.

Mutation check: flipping `path-escape` from `forbidden` to `badRequest`
must turn the suite red before the change is accepted.
