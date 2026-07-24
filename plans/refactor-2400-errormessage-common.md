# refactor(common): move errorMessage into browser-safe @mulmoclaude/common

Closes #2400.

## Problem

`errorMessage(err, fallback?)` (unknown → human-readable string) lives in 4 places:

| File                                                      | Note                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/core/src/utils/errors.ts`                       | #2217 consolidation, but **server-only** surface (`@mulmoclaude/core/utils`) |
| `packages/plugins/accounting-plugin/src/shared/errors.ts` | hand-copy                                                                    |
| `packages/plugins/markdown-plugin/src/utils/errors.ts`    | hand-copy                                                                    |
| `packages/plugins/mulmoscript-plugin/src/vue/support.ts`  | hand-copy (marked "soft-forced" in `docs/shared-utils.md`)                   |

The plugins copy it because `@mulmoclaude/core/utils` is server-only and cannot be
imported from browser (Vue) code. `@mulmoclaude/common` is the zero-dependency,
no-`node:` browser-safe leaf package — the correct home for an isomorphic helper.

## Diff of the 4 implementations

All four are **behaviorally identical for every realistic thrown value** (Error,
gRPC-style `{details}`, `{message}`, string, number, null, undefined). The only
difference from the old `typeof err === "object"` cast is that `isRecord`
excludes arrays: an array carrying a stray string `.message`/`.details` now
falls through to `String(err)` instead of surfacing that property. That input
never occurs in this codebase, and treating an array as error-like was never
intended; the array behaviour is pinned as a deliberate test. Original body:

```ts
export function errorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  if (err !== null && typeof err === "object") {
    const obj = err as { details?: unknown; message?: unknown };
    if (typeof obj.details === "string" && obj.details) return obj.details;
    if (typeof obj.message === "string" && obj.message) return obj.message;
  }
  if (fallback !== undefined) return fallback;
  return String(err);
}
```

Canonical behaviour (kept, no per-plugin behaviour change): Error → `.message`;
non-Error object with a non-empty string `details` (gRPC convention) → `details`;
else non-empty string `message` → `message`; else `fallback` if provided; else
`String(err)`. `details` takes precedence over `message`. Empty-string
`details`/`message` fall through.

> Note: the canonical version uses an `as` cast to read `details`/`message`. In
> common we implement it without `as`/`any` (project rule), using a typed
> property reader.

## Plan

1. Add `errorMessage(err, fallback?)` to `@mulmoclaude/common` (`src/index.ts`),
   exported from the public entry. Implement without `as`/`any`.
2. `packages/core/src/utils/errors.ts` → re-export `errorMessage` from common;
   keep `toError` local (now sourcing `errorMessage` from common). Core's public
   surface `@mulmoclaude/core/utils` is unchanged, so no core/host consumer breaks.
   Add `@mulmoclaude/common` to core `dependencies`.
3. Replace the 3 plugin copies:
   - **markdown**: delete `src/utils/errors.ts`; MarpView.vue imports `errorMessage`
     from `@mulmoclaude/common` (single call site, not a public entry).
   - **accounting**: `src/shared/errors.ts` re-exports `errorMessage` from common
     (justified: `errorMessage` is part of the published `./shared` entry via
     `export * from "./errors"`; re-export preserves that public surface and all
     ~8 internal `../shared/errors` import sites).
   - **mulmoscript**: remove the `errorMessage` function from `src/vue/support.ts`
     (leave `isRecord`/`useClipboardCopy` untouched); the 2 import sites
     (transport.ts, View.vue) pull `errorMessage` from `@mulmoclaude/common`.
   - Add `@mulmoclaude/common` to each plugin's `dependencies` (bundled by vite,
     matching markdown-utils in markdown-plugin).
4. Bump `@mulmoclaude/common` `1.0.0 → 1.1.0` and sweep EVERY declared consumer
   range `^1.0.0 → ^1.1.0` (21 bridges + relay + launcher), add `^1.1.0` to core
   and the 3 plugins. Add a `docs/CHANGELOG.md` entry.
5. Update `docs/shared-utils.md`: the mulmoscript "soft-forced" note → resolved,
   point the errorMessage rows at `@mulmoclaude/common`.

## Tests

`packages/common/test/test_errors.ts`: Error instance, `{ message }`, `{ details }`,
`details` precedence over `message`, empty-string details/message fall-through,
plain string, number, `null`, `undefined`, and the `fallback` argument.
Verify-by-break: invert the `details`/`message` branch, confirm a test goes RED.
