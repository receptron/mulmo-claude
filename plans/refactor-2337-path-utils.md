# refactor: dedup stripFragmentAndQuery + workspace path normalizer in src/utils/path

Issue: #2337

## Context

`jscpd` flagged two duplicated blocks (81 + 71 tokens) inside a single
directory, `src/utils/path/`:

| File | What was duplicated |
|---|---|
| `relativeLink.ts` | `stripFragmentAndQuery(str)`, `normalizeWorkspacePath(path)` |
| `workspaceLinkRouter.ts` | `stripFragmentAndQuery(str)` (byte-identical), `normalizePath(raw)` (same logic, different name) |

Both files answer the same question — "where does this workspace-relative
path end, and what does it collapse to" — and the normalizer's `..`
handling is a **workspace-escape guard**, i.e. security-relevant. Two
copies means a hardening of that guard can land on only one of them.

## What this does

1. New `src/utils/path/posixPath.ts` exporting the two pure functions:
   - `stripFragmentAndQuery(str)` — cut at whichever of `#` / `?` comes first.
   - `normalizeWorkspacePath(path)` — drop `.` / empty segments, `..` pops,
     `..` past the root → `null`, empty result → `null`.
2. `relativeLink.ts` and `workspaceLinkRouter.ts` import from it; the local
   copies are deleted. `workspaceLinkRouter`'s call site renames
   `normalizePath` → `normalizeWorkspacePath`.

Semantics are preserved exactly — this is a move, not a rewrite.

## Deliberately NOT merged

`workspaceLinkRouter.ts`'s `extractQuery(href)` stays where it is. It is
**asymmetric on purpose**: a `?` that appears after a `#` is part of the
fragment, so `extractQuery` returns `""` for it, while
`stripFragmentAndQuery` has already ended the path at the `#` and never
looks at the later `?`. Both agree on where the path ends; they disagree
only about what follows it. Merging them would silently turn a fragment
into a router query. The asymmetry is pinned by a test with the reason in
a comment so a future reader doesn't "fix" it.

## Verification

- `test/utils/path/test_posixPath.ts` — new, exercises both functions
  directly: `../../etc/passwd` escape → `null`, `.` only, empty string,
  trailing slash, consecutive slashes, `a/b/../c`, `#` before `?`,
  `?` before `#`, neither present.
- `test/utils/path/test_workspaceLinkRouter.ts` — extended with the
  `extractQuery` asymmetry pin (through the public `classifyWorkspacePath`).
- Mutation check: temporarily removing the `..`-past-root guard
  (`if (stack.length === 0) return null;`) must turn the escape tests RED.
  Confirmed before shipping, then restored.
