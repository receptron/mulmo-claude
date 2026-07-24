# refactor(core): single-source writeFileAtomic — #2399

## Problem

`writeFileAtomic` (tmp-write → rename, with a Windows retry loop) is implemented
in **three** places (jscpd 200/141/106 tokens), plus a **fourth** copy of the
same safety-critical rename-retry logic hiding in `google/fsJson.ts`:

| File | Shape |
|---|---|
| `server/utils/files/atomic.ts` (host, original) | async + sync, `mode`, `uniqueTmp`, binary |
| `packages/core/src/collection/server/atomic.ts` ("ported from host") | async only, always-unique tmp, binary, no `mode`/opts |
| `packages/plugins/accounting-plugin/src/server/atomic.ts` ("reimplemented") | async, `uniqueTmp`, string only, `isEnoent` + `writeJsonAtomic` |
| `packages/core/src/google/fsJson.ts` (`writeJsonAtomicWithMode`) | async, fixed `.tmp`, `mode` 0600 — its own rename-retry copy |

#2222 aligned tmp-collision semantics but left the copies. The Windows retry
delay table, the EPERM/EBUSY/EACCES gate, and the tmp naming are hand-written in
each. The next Windows error code found will be fixed in one copy only — #2222
is the precedent.

## Canonical public API (superset of all callers)

Home: `packages/core/src/files/{atomic,json,safe}.ts`, exposed on the new
server-only subpath `@mulmoclaude/core/files`.

```ts
export interface WriteAtomicOptions { mode?: number; uniqueTmp?: boolean }   // uniqueTmp defaults true (#2222)
export function writeFileAtomic(filePath, content: string | Uint8Array, opts?): Promise<void>
export function writeFileAtomicSync(filePath, content: string | Uint8Array, opts?): void
export function writeJsonAtomic(filePath, data: unknown, opts?): Promise<void>   // 2-space JSON
export function isEnoent(err: unknown): boolean
// exported for tests (not on the barrel): isTransientRenameError(err, isWindows), renameWithWindowsRetry(from,to,deps)
```

Safety-critical, preserved EXACTLY: `RENAME_RETRY_DELAYS_MS = [30,100,300]`, the
Windows-gated EPERM/EBUSY/EACCES decision, POSIX-rename-atomicity + Windows
AV/Search-Indexer WHY comments. `isTransientRenameError` takes `isWindows` as a
parameter (default = real platform) so it is testable cross-platform; the retry
loop takes injectable `{ rename, sleep, isWindows }` deps (default = real).

## What each caller needs

- **host** `server/utils/files/atomic.ts`: `writeFileAtomic`, `writeFileAtomicSync`, `WriteAtomicOptions` → becomes a thin re-export from `@mulmoclaude/core/files` (keeps the `../utils/files/atomic.js` import path ~30 host modules rely on).
- **core collection** (`io.ts`, `manageTool.ts`, `views.ts`, `importWriter.ts`): `writeFileAtomic` → repoint to `../../files/atomic.js` (and `../../../files/...`); delete `collection/server/atomic.ts`.
- **core google** (`fsJson.ts`): `writeJsonAtomicWithMode` → delegate to canonical `writeFileAtomic(p, json, { mode, uniqueTmp:false })`; drop its rename-retry copy.
- **accounting-plugin** `io.ts`: `writeJsonAtomic`, `isEnoent` → import from `@mulmoclaude/core/files`; delete local `atomic.ts`; add `@mulmoclaude/core` dep.

## Version / ranges

New `./files` subpath = public surface change → bump `@mulmoclaude/core` 1.0.2 → 1.1.0.
Sweep every consumer range `^1.0.2` → `^1.1.0`: collection-plugin (deps+peerDeps),
google-plugin, launcher `packages/mulmoclaude`; add accounting-plugin dep `^1.1.0`.
Launcher OWN version untouched (per CLAUDE.md chore(release) rule). launcherSync
gate stays green (launcher range lower-bound 1.1.0 == workspace 1.1.0).

## Tests

`packages/core/test/files/test_atomic.ts` (imports from src, exercised directly):
- normal write (old-or-new, never half), overwrite, parent-dir create, cleanup-on-failure
- `uniqueTmp:true` concurrent writers to one dest — no race; `uniqueTmp:false` stable `.tmp`
- binary round-trip (no utf-8 mangling), `mode`
- `isTransientRenameError` cross-platform via injected `isWindows` (true→EPERM/EBUSY/EACCES, false, ENOENT, non-error)
- retry loop via injected rename that fails-then-succeeds (Windows path) + injected no-op sleep
- `writeJsonAtomic` 2-space, `isEnoent`

Verify-by-break: invert `isTransientRenameError` → the retry test goes RED → restore.
Host `test/utils/files/test_atomic.ts` stays (now integration-tests the re-export seam).

## Verification

`docs/shared-utils.md` entry added. Gate: format, lint, typecheck, build, test.
