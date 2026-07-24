# @mulmoclaude/common

General-purpose, **dependency-free** runtime type guards shared across the
MulmoClaude host (`server/`, `src/`), the chat bridges (`@mulmobridge/*`), and
the plugins.

This is a **leaf package** — it imports nothing, so any tier can depend on it
without creating an uphill edge (see the dependency-direction rule in the repo
`CLAUDE.md`).

## Why it exists

`server/utils/types.ts` and `src/utils/types.ts` were byte-for-byte duplicates
kept in sync by hand, and the `isObj` guard alone had been re-typed in 18 files
across the bridges and relay. These guards are the definition of "general and
duplicated," so they live here once.

## Contents

| Guard | Narrows to | Notes |
|---|---|---|
| `isRecord(v)` | `Record<string, unknown>` | plain object; **arrays excluded** |
| `isObj(v)` | `object` | any non-null object; **arrays allowed** |
| `isNonEmptyString(v)` | `string` | non-empty **after trimming** |
| `isStringRecord(v)` | `Record<string, string>` | every value is a string |
| `isStringArray(v)` | `string[]` | every element is a string |
| `isUnknownArray(v)` | `unknown[]` | prefer over bare `Array.isArray` (which narrows to `any[]`) |
| `isErrorWithCode(v)` | `{ code: string; message?: string }` | Node.js fs-style errors |
| `hasStringProp(v, k)` | `Record<k, string>` | key present with a string value |
| `hasNumberProp(v, k)` | `Record<k, number>` | key present with a number value |

Plus CSV/env helpers `parseCsvList(raw, { lowercase? })` and
`parseCsvSet(raw, { lowercase? })` (empty set = "allow all" sentinel), and the
helpers below.

| Helper | Returns | Notes |
|---|---|---|
| `errorMessage(v, fallback?)` | `string` | unknown caught value → human-readable string; **isomorphic**, so Vue/browser surfaces use it too |
| `toUtcIsoDate(timestamp)` | `string` | `Date` → `YYYY-MM-DD` in UTC — for dates that must not shift with the host's local timezone |

`errorMessage` surfaces a non-empty string `details` (gRPC convention) or
`message` field of a non-Error object (`details` wins) instead of
`[object Object]`; `fallback` covers a thrown non-Error at an error boundary.
This is the single home the #2217 consolidation could not reach, because
`@mulmoclaude/core/utils` is server-only — core now re-exports this one.

`isRecord` vs `isObj`: use `isRecord` whenever you go on to index string keys —
`isObj` lets arrays through, which is rarely what you want for a JSON payload.
