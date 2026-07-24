# fix — `backlinks`/`rollup` cannot resolve through a `ref` nested inside a `table` field

Source: workspace bug report `~/mulmoclaude/artifacts/backlinks-table-ref-bug.md`
(2026-07-20, reproduced live via `manageCollection`).

## Problem

A `backlinks` field whose `via` uses the dotted form pointing at a ref column
inside a `table` field (e.g. `via: "characters.character"`) passes `putSchema`,
is reported by `getOntology` as a valid relation on **both** sides, yet always
resolves to an empty list. Top-level `via` refs work fine. Because backlinks
resolution is fail-soft by design, the misconfiguration is indistinguishable
from "no linked records" — silently broken for users.

Repro shape: `token-eater.characters` is a `table` whose rows hold
`character: { type: "ref", to: "token-eater-characters" }`;
`token-eater-characters.chapters` is
`{ type: "backlinks", from: "token-eater", via: "characters.character" }`.
`getItems` returns `"chapters": []` even for characters referenced by several
chapters, while the control case (`stock-quotes.holders` via a top-level ref)
resolves correctly.

## Root cause (verified)

`backlinkRows` in `packages/core/src/collection/core/backlinks.ts:29` matches
source records with a flat property lookup:

```ts
sourceItems.filter((item) => fieldTextOrNull(item[spec.via]) === recordId && ...)
```

`item["characters.character"]` is undefined → never matches. Even a `via`
naming the table field itself is skipped deliberately (arrays have no id to
compare). Nothing ever descends into table rows.

Two sibling code paths disagree with the resolver:

- The ontology scanner (`packages/core/src/collection/server/ontology.ts:37-40`)
  **does** walk `table` columns and reports nested refs as `${key}.${subKey}` —
  so `getOntology` advertises the relation as real.
- Schema validation (`packages/core/src/collection/core/schemaZ.ts:254`, `:277`)
  only requires `via` to be a non-empty trimmed string — a dotted `via`
  validates without warning.

## Fix

Support **one level** of table nesting in `via`, inside `backlinkRows` only —
`rollupValue` (`backlinks.ts:64`) delegates to it, so rollups are fixed by the
same change, and both server enrichment (`server/derive.ts`) and the client
detail view (`useCollectionRendering.renderers.ts`) share these helpers, so one
fix covers `getItems` and the UI.

Semantics:

- `via: "<tableField>.<refColumn>"` (split on the **first** `.`): a source
  record matches when `Array.isArray(item[tableField])` and **any row** has
  `fieldTextOrNull(row[refColumn]) === recordId`.
- A record referencing the target in multiple rows appears **once** — free,
  since `filter` over `sourceItems` yields each record at most once.
- Non-dotted `via` behavior byte-for-byte unchanged.
- Stays fail-soft: a dotted `via` whose table field is absent/non-array, or
  whose rows lack the column, matches nothing — same contract as today.
- `projectBacklinkRow`, `filter`, `display`, and rollup `column` all operate on
  the **source record** (not the row), so they need no changes.

Keep the helper pure and split out a small
`viaMatches(via: string, item: CollectionItem, recordId: string): boolean`
so the 20-line / cognitive-complexity rules hold and the dotted case is unit-
testable in isolation.

## Files

- `packages/core/src/collection/core/backlinks.ts` — the fix (`viaMatches` +
  use in `backlinkRows`); update the header comment about array skipping.
- `packages/core/assets/helps/collection-skills.md` — `backlinks`/`rollup`
  `via` docs (~line 185): document the dotted form and its any-row semantics.
- `packages/core/package.json` — bump `0.29.0` → `0.30.0` (help asset changed →
  core must ship; bump in the same PR per repo rule, publish after merge on
  explicit ask). Launcher dep range moves in lockstep
  (`packages/mulmoclaude/package.json`); do NOT ratchet plugins' core ranges.
- Tests — new `packages/core/test/collection/test_backlinks.ts` (node:test)
  covering: dotted via matches any-row; once-per-record dedup on multi-row
  reference; non-array / missing table field → no match; top-level via
  regression; `rollupValue` count/sum through dotted via; `filter`/`display`
  on the source record still applied.

## Non-goals

- Deeper nesting (`a.b.c`) — reject implicitly (first-`.` split makes the rest
  the column name; still fail-soft).
- `putSchema` rejection/warning of dotted `via` — moot once it resolves; and
  relation-target validation is deliberately fail-soft everywhere.
- No engine-contract change (no new API surface), so no MulmoTerminal
  host-route port is needed — it picks the fix up via its next core dep bump.

## Verification

- `yarn test` — new backlinks tests + existing derive/rendering tests green.
- `yarn format` / `yarn lint` / `yarn typecheck` / `yarn build` green.
- Live repro from the report: restore the `chapters` backlink on
  `token-eater-characters` in the reporting workspace → `getItems` on a
  character lists its chapters; chapter side unchanged.
