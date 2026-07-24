# refactor: dedup the catalog-source + external-args preamble in skills.ts

Issue: #2367

## Context

`jscpd` flags a 56-token clone inside `server/api/routes/skills.ts`: the
`catalogPreview` and `catalogStar` handlers open with the same
"validate the catalog source, then validate the external arguments"
preamble. Only four things differ — the input container (`req.query` vs
`req.body`), the catalog op, the response formatter, and the word
`preview` / `star` in one error message.

`repoId` and `skillFolder` are path components: they are joined as
`${repoId}/${skillFolder}` and handed to the external-repo readers. Two
hand-written copies of that validation means a third external endpoint
can ship with a looser one.

## What this changes

New `server/api/routes/skillCatalogTarget.ts` exporting
`resolveCatalogTarget(input, action, res)`, which returns

```
{ kind: "external"; source: "external"; repoId; skillFolder }
| { kind: "catalog";  source: "preset";   slug }
| null   // a 400 has already been sent
```

Both handlers become `const target = resolveCatalogTarget(...); if (!target) return;`
— the resolve-or-respond convention already used by
`loadCollectionOr404` / `resolveCustomViewOr404` in `collections.ts`
(#2144) and by `resolveSourceOrError` in the skills catalog (#2156).

`action` is `"preview" | "star"` and only fills the one word that
already differed between the two messages.

## Constraints honoured

- **No user-visible string changes.** All four messages are byte-identical
  to what each handler sent before; only the `preview` / `star` word is
  parameterised.
- **`unknown` in, narrowed inside.** `req.query` values can be
  `string | string[] | undefined` and `req.body` values are `unknown`;
  the helper takes `unknown` fields and narrows, so neither call site is
  loosened to match the other. An array `source` (`?source=a&source=b`)
  still fails `isCatalogSource` exactly as before.
- **Not `isNonEmptyString`.** `@mulmoclaude/common`'s guard trims, so
  adopting it would newly reject a whitespace-only `repoId` — a live API
  behaviour change. The local guard keeps the original
  `typeof x === "string" && x.length > 0` semantics; the asymmetry is
  pinned by a test.
- Helper is 17 lines, cognitive complexity well under the 15 threshold.

## Tests

`test/api/routes/test_skillCatalogTarget.ts` (node:test + node:assert,
mock `Response` recorder in the style of `test/utils/test_httpError.ts`):
unknown / missing / array `source`; `external` with empty, non-string or
missing `repoId` / `skillFolder`; a valid external pair; non-external with
an empty or non-string `slug`; a valid non-external target; and that
`preview` / `star` each produce their own wording. Status **and** exact
message are asserted.

Test integrity verified by reverting: dropping the `repoId.length === 0`
half of the guard turns the empty-`repoId` cases red (helper returns an
external target instead of a 400) and leaves the rest green.

## Verification

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.
