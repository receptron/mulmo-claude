# Phase 2 — bridges + relay `isObj` → `@mulmoclaude/common` `isRecord`

Follows Phase 1 (#2267, merged): `@mulmoclaude/common` leaf package now holds the shared
runtime type guards, and the host (`server/utils/types.ts`, `src/utils/types.ts`) re-exports it.

## Goal

Remove the 16 hand-written local `isObj` guards in the bridges + relay and route them
through `isRecord` from `@mulmoclaude/common`, so the guard stops being re-implemented in
every package.

## Scope (16 source files, 13 package.json)

Bridges (12): chatwork, google-chat, webhook, line-works, messenger, zulip, bluesky,
mattermost, rocketchat, signal, viber, whatsapp.
Relay (4 webhook files, 1 package): google-chat, messenger, teams, whatsapp.

**Excluded — mastodon.** It *exports* `isObj` from `parse.ts` and unit-tests it
(`test_parse.ts` asserts `isObj([]) === true`). Switching it to array-excluding `isRecord`
is a 3-file coordinated change with a behavior flip in the test — done separately.

## Semantic note (array handling)

Local `isObj` = `typeof x === "object" && x !== null` (arrays **allowed**, narrowed to
`Record<string, unknown>` / `JsonRecord`). `isRecord` additionally excludes arrays.
Verified behavior-safe: every call site immediately accesses string keys or does a
following `Array.isArray(x.prop)` check, so an array argument was never a valid pass —
excluding it only makes the guard more correct. No call site passes a value expected to
be an array.

## Per-file mechanics

1. Delete the local `function isObj(...) { ... }`.
2. For webhook, line-works, viber — the `type JsonRecord = Record<string, unknown>` alias
   becomes unused once `isObj` is gone, so delete it too. (chatwork, bluesky, rocketchat,
   signal, zulip keep the alias — used by other signatures.)
3. Add `import { isRecord } from "@mulmoclaude/common";` after the last `@mulmobridge/*`
   import (alphabetical: `@mulmobridge` < `@mulmoclaude`).
4. Rename every `isObj(` call to `isRecord(`.
5. Add `"@mulmoclaude/common": "^0.1.0"` to each bridge's `dependencies` and to relay's.

## Release prerequisite (must note in PR)

`@mulmoclaude/common` is **not yet published to npm** (workspace-only, created in Phase 1).
Bridges build with `tsc` (no bundling) and ship raw runtime deps, so `@mulmoclaude/common`
**must be published to npm before the next bridge / relay publish**, or `npm i` of those
packages breaks. Same obligation Phase 1 already created for the launcher. Merging this PR
is safe (workspace resolves via symlink); only the *next publish* of a consumer is gated.

## Verify

`yarn install` (relink) → `yarn format` → `yarn lint` → `yarn typecheck` → `yarn build`.
Bridges/relay have no unit tests for this; the guards are exercised via the host suite.
