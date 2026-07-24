# refactor: single-source the faithful-copy host helpers in mulmoscript/x-plugin (#2461)

## Problem

Plugins cannot import host code (uphill imports are forbidden), so two host
helpers were duplicated into plugins as documented "faithful copies"
(jscpd alerts #360, #365):

1. **`errorMessage`** (unknown → message string, gRPC `details`-then-`message`
   unwrap) — 3 local copies:
   - `packages/plugins/mulmoscript-plugin/src/server/support.ts` (`errorText`)
   - `packages/plugins/mulmoscript-plugin/src/core/plugin.ts` (`errorText`,
     simpler variant without the `details`/`message` unwrap)
   - `packages/plugins/x-plugin/src/internal.ts` (`errorMessage`)
   The canonical implementation already lives in `@mulmoclaude/common`
   (browser-safe zero-dep leaf, #2400); `@mulmoclaude/core/utils` and
   accounting/markdown/mulmoscript-vue already import it.
2. **`resolveWithinRoot`** (realpath-based path-containment check) —
   `packages/plugins/mulmoscript-plugin/src/server/support.ts` holds a
   byte-identical copy of `server/utils/files/safe.ts`'s function, with a
   header comment saying the security-critical primitive "must not drift per
   host". Single-sourcing is the stated intent of that comment.

## Approach

### A. `errorMessage` → `@mulmoclaude/common`

- mulmoscript-plugin already depends on `@mulmoclaude/common ^1.1.0`
  (used by its vue entry). Delete both local `errorText` definitions and
  import `errorMessage` from common at every call site
  (`server/ops.ts`, `server/mulmoErrorCapture.ts`, `core/plugin.ts`).
- x-plugin: delete the local `errorMessage` from `src/internal.ts`;
  `client.ts` / `index.ts` import it from `@mulmoclaude/common` directly.
  **x-plugin gains its first prod dependency** (`@mulmoclaude/common ^1.1.0`,
  the range every other consumer declares). Like markdown/accounting-plugin,
  the dep is declared but not externalized in the vite build (common is a
  tiny pure leaf; inlining is those packages' existing convention).
- Behavior notes:
  - support.ts `errorText` is byte-identical to common's `errorMessage`
    modulo the additive optional `fallback` parameter (not passed → same
    behavior).
  - core/plugin.ts `errorText` was the simpler
    `err instanceof Error ? err.message : String(err)` variant; folding onto
    common adds the `details`/`message` unwrap for non-Error objects. Its two
    call sites wrap `JSON.parse` failures (always `SyntaxError`, an `Error`),
    so observable behavior there is unchanged.
- Reword the "self-contained port" header comments to stay truthful: the
  packages still carry no dependency on the host **server tree**; a leaf
  package dependency is allowed for any tier.

### B. `resolveWithinRoot` → `@mulmoclaude/core/files`

- Move the function (exact body: normalize → resolve → realpathSync-or-null →
  root or root+sep prefix check) into `packages/core/src/files/safe.ts` and
  export it from the existing server-only `./files` subpath (the barrel that
  already single-sources `writeFileAtomic` per #2399 — same "safety-critical
  file primitive" home, `require`/`default` conditions already declared).
- Host `server/utils/files/safe.ts` deletes its local copy and re-exports
  from `@mulmoclaude/core/files` (same import-surface-preserving pattern as
  `server/utils/files/atomic.ts` and `server/utils/errors.ts`).
- mulmoscript `support.ts` deletes its copy; `server/ops.ts` imports from
  `@mulmoclaude/core/files` (already externalized as `/^@mulmoclaude\/core/`
  in the plugin's vite config, and already a declared dependency).

### Tests

- New `packages/core/test/files/test_safe.ts`: containment inside root
  (top-level + nested), `..` traversal escape, symlink escaping the root
  (real temp dirs + symlinks), nonexistent path → null, root itself
  (empty relPath / `.`).
- Mutation check: break the prefix check in core's copy, watch the new test
  fail, restore.
- Host `test/utils/test_fs.ts` (comprehensive `resolveWithinRoot` suite)
  keeps running against the host re-export, proving the host surface is
  unchanged.

### Out of scope (deliberate)

- x-plugin's `toUtcIsoDate` / `safeResponseText` / `fetchWithTimeout` ports
  (alert #261): documented compact ports with intentional differences — KEEP.
- `isRecord` in mulmoscript `support.ts` (3-line type guard, below clone
  threshold; common also exports one, but folding it is not part of #2461's
  verified triage).
- The remaining `errorMessage` copies in spotify/html plugins (tracked in
  `docs/shared-utils.md` drift table; same recipe applies later).

## Release ordering

`@mulmoclaude/core` must be published (with the new `./files` export) before
the next npm publish of `mulmoclaude`/hosts or `@mulmoclaude/mulmoscript-plugin`;
`@mulmoclaude/x-plugin`'s next publish needs `@mulmoclaude/common` available
(already published as 1.1.0). No version bumps in this PR per the
`chore(release)` rules — ranges already track the latest published versions.

## Verification

- `yarn format && yarn lint && yarn typecheck && yarn build && yarn test`
- jscpd (same invocation as `.github/workflows/duplication-scan.yaml`):
  the support.ts↔safe.ts and support.ts/internal.ts↔host clone pairs are
  gone; no new clones introduced.
