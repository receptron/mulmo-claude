# Phase 3 PR1 — allowlist parsing → `@mulmoclaude/common` (+ common graduates to 1.0.0)

Follows the Phase 3 scoping (see [`plans/done`] / memory). The single biggest bridge
duplication — the CSV/env allowlist Set-builder — is a **generic, pure** helper, so it
belongs in the drift-exempt leaf `@mulmoclaude/common`, NOT `@mulmobridge/client`.

## What

1. **`@mulmoclaude/common` gains** `parseCsvList(raw, { lowercase? })` and
   `parseCsvSet(raw, { lowercase? })` (+ tests). Empty/absent input → empty list/set,
   which is the canonical "allow all" sentinel (`set.size === 0`).
2. **17 bridges** replace the hand-written
   `new Set((process.env.X ?? "").split(",").map(v => v.trim()[.toLowerCase()]).filter(Boolean))`
   block with `parseCsvSet(process.env.X, { lowercase? })`. nostr's relay-CSV also folds
   into `parseCsvList`. ~85 lines removed.
3. **`@mulmoclaude/common` graduates 0.1.0 → 1.0.0** (per the user's "packages updated
   going forward start at 1.0.0+" directive — adding these exports is common's first
   update). All 15 existing consumer ranges swept `^0.1.0 → ^1.0.0`; the 8 bridges newly
   using it get `^1.0.0`. `^0.1.0` does NOT accept 1.0.0, so the sweep is mandatory for
   the workspace to keep symlinking the local 1.0.0 instead of fetching npm's 0.1.0.

## Excluded / gotchas

- **telegram** — its `parseAllowlist` is numeric, **throws** on a bad entry, and treats
  empty as **deny-all** (opposite of the string bridges' empty→allow-all). Folding it in
  would flip its security default. Left entirely untouched.
- **`{ lowercase: true }` is load-bearing** for xmpp (JIDs), email (addresses), nostr
  (hex pubkeys) — case-insensitive identifiers. The other 14 stay case-sensitive.
- Cost: `common` is outside the drift gate and not in the smoke trigger paths, so no
  version-bump dance — same cheap target as Phases 1-2. Only the launcher range change
  touches the launcher-sync gate, which passes (range lower-bound == workspace version).

## Release prerequisite

`@mulmoclaude/common@1.0.0` MUST be published to npm before any consumer (bridge / relay /
launcher) is next published, or their `^1.0.0` range can't resolve. Merge is safe
(workspace symlink); publish 1.0.0 right after merge via `/publish`.

## Verify

install → format → lint (0 new) → typecheck → build → common tests → deps/drift/smoke/
launcher-sync — all green.

## Not in this PR (deferred)

- PR2: Meta `hub.challenge` verify → `@mulmobridge/webhook-runtime`.
- `frameText` / `fetchJsonOrThrow` → `@mulmobridge/client` (expensive dance; piggyback later).
