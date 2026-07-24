# refactor: dedup collections route-handler resolve-or-404 preambles

Issue: #2144

## Context

Follow-up to #2141 (server/ path-guard + tree-builder dedup). The
`duplication-scan` (jscpd) gate surfaced that `server/api/routes/
collections.ts` repeats the same resolve-or-404 preambles across its
route handlers. This is genuine knowledge duplication — the "resolve a
collection (or its custom view) or respond 404" contract — repeated ~16
times, exactly the class of drift a single helper prevents.

## What this fixes

### `loadCollectionOr404(slug, res)`

`const collection = await loadCollection(slug); if (!collection) {
notFound(res, \`collection '<slug>' not found\`); return; }` appeared in
**16 handlers**. Extracted to one helper; callers become
`const collection = await loadCollectionOr404(slug, res); if (!collection) return;`.
Behaviour is identical (same 404 message, `slug` = the same value each
site already passed).

### `resolveCustomViewOr404(slug, viewId, res)`

The view-file / view-i18n / view-token routes additionally repeated the
`loadCollectionOr404 + find view by id + 404` block. Extracted into one
helper returning `{ collection, view }` or null.

## Deliberately NOT in this PR

- POST-create / PUT-item write-result handling (invalid-id / path-escape
  / conflict) — the two handlers diverge after the shared preamble;
  extracting the tail risks over-abstraction. Left as-is.
- Package-level duplication (bridges etc.) — separate follow-up via a
  shared package.

## Result

jscpd clone pairs touching collections.ts: **~8 → 5** (same base). The
remaining 5 are the deliberately-skipped items write region. Beyond the
flagged count, the 16→1 collapse of the load-or-404 contract is the real
win — a future change to the 404 behaviour now lands in one place.

## Verification

- `yarn lint` / `typecheck:server` clean (lint caught + fixed one
  dead-store `collection` in the view-token route where only `view` is
  used).
- Pure extraction, no behaviour change; covered by the full `yarn test`
  gate on commit. No dedicated route test exists for this file to extend.
