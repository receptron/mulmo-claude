# Migrations

Step-by-step instructions for crossing a major-version boundary in
`@mulmobridge/protocol`. Patch and minor releases are documented in
[`CHANGELOG.md`](./CHANGELOG.md); breaking changes are documented here in
addition to the changelog.

If a release does not appear here, it did not introduce a breaking change.

## Format for new entries

When a future major bump lands, add a new section using this shape:

> ### `X.Y.Z` → `(X+1).0.0`
>
> **Why this is breaking** — one or two sentences on the contract change.
>
> **Affected exports** — bullet list of types / constants whose shape moved.
>
> **What you need to do** — concrete diff-style steps. Include either a
> codemod command or hand-port instructions.
>
> **If you can't migrate yet** — name the last version that supported the old
> shape (`@mulmobridge/protocol@<X.Y.Z>`).

## `0.1.x` → `0.2.0`

Not breaking — the 0.2.0 bump only declares the semver policy. Pinning your
dependency to `^0.2.0` is enough; no source code change is required.
