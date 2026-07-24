# refactor: consolidate the logger interface family via type aliases

Closes #2486.

## Problem

Two structurally-identical logger shapes are re-declared across the repo
(Code Scanning alerts #186/#187/#188 for the 4-method family anchored on
`collection/server/host.ts`, #358 for the 3-method pair, #412 for the
collection ↔ host-logger pair):

- **4-method `(prefix, message, data?)`** — core `hostSlot.ts`
  (`StructuredLogger`), `CollectionLogger`, `FeedsLogger`, `GoogleLogger`,
  host `server/system/logger` `Logger`, accounting-plugin `AccountingLogger`,
  chat-service `Logger`.
- **3-method `(message, data?)`** — `SchedulerLogger`, mulmoscript
  `MulmoScriptServerLog`, plus subsets `NotifierLogger` (warn/error) and
  `CollectionWatcherLogger` (info/warn).

The #2401 plan kept the re-declarations "so the public surface is unchanged" —
adversarially re-verified in #2486: `export type X = StructuredLogger` keeps
both the exported name and the structural d.ts surface, so re-declaration buys
nothing.

## Plan

1. **Canonical declarations in `@mulmoclaude/common`** (`src/logger.ts`,
   type-re-exported from `src/index.ts`): `StructuredLogger` (4-method) and
   `MinimalLogger` (3-method). Common is the only zero-dep leaf every consumer
   (host, core, plugins) can already reach. No version bumps in this PR — the
   new exports ship with the next `@mulmoclaude/common` publish.
2. **Core (Phase 1, alerts #186/#187/#188)** — `hostSlot.ts` re-exports
   `StructuredLogger` from common instead of declaring it; collection / feeds /
   google replace their re-declared interfaces with
   `export type <Name>Logger = StructuredLogger;` (names stay exported from each
   domain index).
3. **3-method family (alert #358)** — `SchedulerLogger` and
   `MulmoScriptServerLog` become aliases of `MinimalLogger`;
   `NotifierLogger` → `Pick<MinimalLogger, "warn" | "error">`,
   `CollectionWatcherLogger` → `Pick<MinimalLogger, "info" | "warn">`
   (signatures verified char-for-char before aliasing).
4. **Optional 4-method sites (alert #412)** — host
   `server/system/logger/index.ts` `Logger` and accounting-plugin
   `AccountingLogger` become aliases too (both already resolve
   `@mulmoclaude/common`; accounting declares the dep). chat-service `Logger`
   is left as-is: `@mulmobridge/chat-service` has no `@mulmoclaude/common`
   dependency and this PR adds no new dependencies.
5. Catalog rows for both types in `docs/shared-utils.md`, plus a
   "Known duplicates" row naming the canonical and the one deliberate copy
   (the section CLAUDE.md requires for any family with >1 live implementation).

## Verified non-sites

Grepping the two shapes also turns up three declarations that are NOT members of
the family; recorded so a future sweep does not mistake them for missed sites:

- `packages/core/src/whisper/internal.ts` `WhisperLogger` — same three method
  names, but `data` is `unknown`, not `Record<string, unknown>`. Aliasing it to
  `MinimalLogger` would *narrow* the parameter and break the host adapter in
  `server/system/whisper/index.ts` that already widens into it.
- `packages/core/src/file-change/index.ts` (`warn?:`) and
  `packages/core/src/workspace-setup/sync.ts` (`onInfo?` / `onWarn?`) — inline
  callback fields on a config object, named for their role in that config rather
  than as a logger. Aliasing reads worse than the inline signature.

## Tests

`packages/core/test/host/test_loggerAliases.ts` pins the alias contract on both
sides. The compile-time half is a round-trip assignment chain
(`StructuredLogger` → the `hostSlot` re-export → `CollectionLogger` →
`FeedsLogger` → `GoogleLogger` → back): an alias that *gains* a member breaks the
assignment into it, one that *loses* a member breaks the assignment back out. The
subset aliases are pinned with fresh object literals, so a missing member fails
and an extra one trips excess-property checking. That half runs under
`yarn typecheck` (core's tsconfig includes `test/`); `Object.keys` assertions
repeat the pin at runtime, because `tsx --test` strips types without checking
them.

Verify-by-break: giving `FeedsLogger` an extra `trace` member turned the
round-trip test red (`TS2741: Property 'trace' is missing in type
'StructuredLogger'`), and narrowing `NotifierLogger` to
`Pick<MinimalLogger, "warn">` turned the subset test red (`TS2353: 'error' does
not exist in type 'NotifierLogger'`). Both restored green.

## Verification

Type-only change — no runtime behaviour moves. Gates: `yarn format` /
`yarn lint` / `yarn typecheck` / `yarn build` / `yarn test`. The emitted d.ts
for `@mulmoclaude/core/collection/server`, `/feeds/server`, `/google`,
`/scheduler`, notifier, collection-watchers, mulmoscript-plugin and
accounting-plugin are diffed before/after to confirm each public name still
resolves to the same structure. jscpd (CI ignore string) re-run: the five
logger clone pairs must be gone with no new clones.
