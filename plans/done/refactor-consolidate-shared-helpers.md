# refactor: consolidate duplicated shared helpers into @mulmoclaude/core

Issue: #2217

## What triggered this

A duplication audit of the repo. The headline finding was **not** the one that
looked scariest at first: the plugin architecture is already polymorphic
(`definePlugin` + `PluginMeta` + two registries + codegen barrels, no per-plugin
branching in the host), so there was nothing to abstract there. The real problem
was duplicated **logic** — the same helper written N times, already drifted.

## Verified before fixing (the audit over-claimed twice)

Every claim was re-checked against the code; two did not survive.

| Claim | Verdict |
| --- | --- |
| `truncate` core copy violates its own "never exceeds `max`" docblock | **True.** `truncate("hello", 2, "...")` → host `".."` (2 chars), core `"..."` (3). But the sole core caller uses the 1-char default ellipsis, so it never fired — a trap, not a live bug. |
| `errorMessage` core copies print `[object Object]` | **Partly.** Three behaviours existed, not two. All agree on `Error` instances, which is what the callers actually catch, so this too was latent. |
| `slugify` produces `foo-bar` vs `foo-bar-` | **False — did not reproduce.** All three copies strip trailing hyphens. The real difference is truncation *order*: titles starting with punctuation get a slug a few chars shorter in html/mulmoscript. Cosmetic; filenames are throwaway + timestamped. |

So none of these were user-visible bugs. The value here is removing the traps and
the structure that keeps regrowing them.

## Approach

The core copies exist deliberately — core cannot import `server/` (dependency
direction). So "delete the copy, use the host's" is not available. Instead:
**canonical lives in core, host re-exports it** (the "pull it OUT into core"
pattern).

- New `packages/core/src/utils/{errors,text,index}.ts` — browser-safe, pure
  string work, no node imports.
- New `@mulmoclaude/core/utils` export subpath.
- Six core-internal `errorMessage` copies collapse to one. These were **pure
  accidental drift** — same package, intra-package imports are unrestricted;
  nothing ever required them.
- `google/util.ts`'s `"unknown error"` default is **dropped**, not preserved.
  The first attempt threaded it through as an explicit `UNKNOWN_ERROR` fallback
  at the 4 call sites; measuring the result showed that was wrong — the
  canonical returns `fallback` *before* `String(err)`, so a thrown **string**
  came back as `"unknown error"` instead of its own content, and `Error("")`
  rendered as an empty `()` in a user-facing template. It also recreated a
  second behaviour, which is the thing this PR exists to remove. Google now
  behaves exactly like the host everywhere.
- Host `server/utils/{errors,text}.ts` and `src/utils/errors.ts` become thin
  re-exports. Chosen over repointing 92 files / 342 call sites: the goal is one
  *implementation*, and the import path staying put keeps the diff reviewable.
  (This is a deliberate exception to the repo's no-re-export rule; the reason is
  written into each file.)

## Version bump is load-bearing here

Published `@mulmoclaude/core@0.26.0` has 25 export subpaths and **no `./utils`**
(verified via `npm view`). The launcher resolves `^0.26.0` from npm, so shipping
the host's `@mulmoclaude/core/utils` import against it would fail at runtime for
npm-installed users — repo users are fine either way (workspace symlink).

Hence: core `0.26.0 → 0.27.0` (minor: new API), launcher dep range `^0.27.0`,
and the two plugins declaring core as a peer (`collection-plugin`,
`google-plugin`) bumped to match — the launcher-sync gate caught that.

**Sequencing constraint: `@mulmoclaude/core@0.27.0` must be published to npm
before the launcher is next published.** The launcher's own `version` is
untouched, per the `chore(release)` rule.

## `docs/shared-utils.md`

Reviewed end to end. Six entries had rotted (three pointed at files that no
longer exist; three named exports that don't exist under those names). All
corrected.

Added a **"Known duplicates"** table. This is the important part: the catalog's
failure mode was listing *one* member of a family and hiding the rest, which is
exactly how `errorMessage` reached 14 implementations while the entry named 2.
The table names every family that still has >1 live implementation, marks which
are architecturally forced vs. accidental, and flags the ones that have actually
diverged.

## Deliberately NOT in this PR

Found during the audit, real, but out of scope — each needs its own change:

- **`isRecord` — 2 of 14 copies let arrays through.** `server/plugins/runtime-loader.ts`
  and `spotify-plugin/src/normalize.ts` omit `!Array.isArray`, so an array narrows
  to `Record<string, unknown>` and gets indexed by string key. The host one is
  accidental — `server/utils/types.ts` already exports the array-tolerant `isObj`.
- **`fetchWithTimeout` in `x-plugin` overwrites a caller-supplied `signal`.**
  An already-aborted signal still issues the request; a mid-flight abort is
  ignored until the 10s timeout. Safe only while no X tool passes one.
- **`writeFileAtomic` silently ignores `opts.mode`** in the core and accounting
  copies — files land at default umask instead of the requested permissions.
- Plugin-local `errorMessage` / `slugify` copies: soft-forced (those plugins
  carry no `@mulmoclaude/core` dep). Left alone, now documented.

## Verification

`yarn format` / `lint` / `typecheck` / `build` / `test` / `check:launcher-sync`.
