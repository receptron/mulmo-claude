# refactor: extract a generic `validateEntryList` from the two workspace config validators

Issue: #2341

## Context

`jscpd` flagged 51 tokens × 2 blocks between `validateCustomDirs`
(`server/workspace/custom-dirs.ts`) and `validateReferenceDirs`
(`server/workspace/reference-dirs.ts`). Both are the same rule for
"validate an API-supplied config array with an entry cap":

1. not an array → `{ error: "expected an array" }`
2. over `MAX_ENTRIES` → `{ error: "too many entries (max N)" }`
3. per item → `validateEntry`, collecting `entry ${i}: ...` on failure
4. any errors → join with `"; "`

Only the entry type, the per-entry error wording, and the echoed property
name (`path` vs `hostPath`) differ. Even the `hasStringProp` guard that
keeps `[object Object]` out of the error — and its explanatory comment —
is written twice.

## What changes

New `server/utils/validateEntryList.ts` exporting

```ts
validateEntryList<T>(raw, { maxEntries, validateEntry, echoProp, describeInvalid })
  : { entries: T[] } | { error: string }
```

- `maxEntries` is a **parameter**, not a shared constant: custom dirs cap
  at 100, reference dirs at 20. They are unrelated limits that happen to
  share a variable name.
- `echoProp` names the property echoed in the per-entry error; the
  `hasStringProp` guard lives inside `validateEntryList`, so the
  `[object Object]` reasoning is stated once.
- `describeInvalid(echoedValue)` supplies only the wording after
  `entry ${i}: `, so both call sites keep their exact current text.

`validateCustomDirs` and `validateReferenceDirs` become thin wrappers.
`validateReferenceDirs` keeps its extra duplicate-label pass afterwards.

## Constraints

- Error strings are part of the HTTP response body — **byte-identical**
  before and after. Grep `"expected an array"`, `"too many entries"`,
  `"invalid path"`, `"invalid or blocked path"` to confirm.
- No `any`, no `as` casts: `validateEntry` is passed as a typed
  `(item: unknown) => T | null` parser and `T` is inferred at each site.

## Tests

`test/utils/test_validateEntryList.ts` (node:test + node:assert/strict),
covering: non-array input, `null` / `undefined`, empty array, exactly
`maxEntries`, `maxEntries + 1`, all items invalid, some items invalid
(index numbering), a non-string echoed property (must not render
`[object Object]`), and a valid list passing through unchanged.

The existing `validateCustomDirs` / `validateReferenceDirs` error-text
tests stay as the wrapper-level regression net.

Mutation check: flipping the cap comparison from `>` to `>=` must turn the
"exactly maxEntries" test red.
