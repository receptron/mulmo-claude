# refactor: dedup artifact path-guards + directory-tree builders (server/)

Issue: #2140

## Context

The `duplication-scan` (jscpd) Code Scanning gate (#2129) surfaced ~192
clone pairs. Most are natural duplication that should NOT be touched
(per-package `vite.config.ts`, per-plugin `lang/*` i18n, `bridges/*`
adapter boilerplate, cross-package pairs that can't be DRY'd without
violating the dependency-direction rules). This PR fixes the subset that
IS genuine knowledge duplication: two clusters in `server/`, both fully
inside host code (no package-boundary concerns).

## What this fixes

### 1. `server/index.ts` — `/artifacts/{images,html,svg}` mounts

All three static mounts inlined the same path guard: decode the request
path (fail-closed on malformed `%`), realpath-confine it under the
storage root, and (html/svg) reject dotfile segments. Three copies of a
**security guard** is exactly the `truncate()`-grew-to-6 hazard (#1304):
a fix has to land in all three or one drifts.

- Extract `resolveArtifactRequestPath(rootReal, reqPath, denyDotfiles)`
  into `safe.ts` (co-located with `resolveWithinRoot` /
  `containsDotfileSegment`).
- Extract `makeCachedRealpath(dir)` — the three `getXDirReal()` getters
  were the same lazy-cached-realpath pattern.
- Behaviour preserved exactly: images passes `denyDotfiles: false` (it
  never short-circuits, so `express.static`'s `dotfiles: "deny"` stays
  the authority); html/svg pass `true` (they serve the file themselves,
  bypassing express.static).

### 2. `server/api/routes/files.ts` — tree builders

The directory-entry visibility filter (hidden/sensitive/symlink/
gitignore/stat) was copied between the recursive `buildTreeAsync` and
`dirEntryToNode`; the assemble-and-sort tail was copied between
`buildTreeAsync` and `listDirShallow`.

- Extract `resolveVisibleChild(entry, absPath, relPath, localFilter)`
  and `assembleDirNode(childPromises, relPath, modifiedMs)`.
- Covered by existing `test_filesTreeAsync.ts` / `test_filesRoute.ts`.

## Deliberately NOT in this PR

- `files.ts` POST-create / PUT-content validation preamble — the two
  handlers diverge; extracting risks over-abstraction.
- `agent/stream.ts` stateful vs stateless parser — intentionally
  separate; DRYing would couple the test-convenience path to production.
- Package-level duplication (bridges, cross-package) — will go in a
  follow-up via a shared/common package (the "pull shared code into
  core / a leaf lib" pattern), not addressed here.

Also queued for follow-up server-route dedup: `wiki/history.ts`
(snapshot-param preamble), `collections.ts` (custom-view resolve).

## Result

jscpd clone pairs (same base, `--format typescript`, tests excluded):
**192 → 187** (index.ts 3→0, files.ts 4→2). The two remaining files.ts
pairs are the deliberately-skipped route preamble + one cross-file pair.

## Verification

- New unit test `test/utils/files/test_safe_artifact.ts` locks the
  extracted guard (in-root accept, malformed-`%` reject, traversal
  reject, dotfile deny/allow per flag, encoded-backslash, cached
  realpath).
- `yarn lint` / `typecheck:server` / `typecheck:test` clean; existing
  file-tree + safe tests pass (96/96).
