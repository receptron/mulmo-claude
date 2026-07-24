# Phase 3 PR2 — Meta `hub.challenge` verify → `@mulmobridge/webhook-runtime`

Stacked on PR1 (`refactor/common-phase3-allowlist`, #2272).

## What

- **`@mulmobridge/webhook-runtime`** gains `SAFE_CHALLENGE_RE` + `narrowChallenge(raw)`
  (the CodeQL sanitiser for Meta's `hub.challenge` echo — Codex review on #1328).
  These were **byte-identical** in `messenger/src/verify.ts` and `whatsapp/src/verify.ts`.
- Both bridge `verify.ts` deleted; messenger/whatsapp import `narrowChallenge` from
  `@mulmobridge/webhook-runtime` instead.
- The two root regression tests (`test/packages/bridges/{messenger,whatsapp}/test_verify.ts`,
  themselves near-duplicates) are consolidated into webhook-runtime's own comprehensive
  test (accepted forms, rejected: empty / >256 / non-string / array-bypass / XSS payloads /
  non-base64url / non-ASCII, anchored-regex sanity). Runs in CI via `yarn workspaces run test`.

## Version — webhook-runtime graduates to 1.0.0

Per the maintainer's "packages updated going forward start at 1.0.0+" directive (applied
to `@mulmobridge/*` too, per explicit choice). Bump `0.1.0 → 1.0.0`; sweep the 6 consumer
ranges `^0.1.0 → ^1.0.0` (google-chat, line-works, messenger, viber, line, whatsapp).
webhook-runtime is NOT a launcher dep → not drift-gated, not in smoke trigger paths, so no
PR-blocking dance; the sweep is for correctness (`^0.1.0` won't accept 1.0.0).

Note: this leaves `@mulmobridge/*` version-inconsistent for now (client 0.1.5, protocol
0.1.4 stay 0.x). A coordinated `@mulmobridge/*` graduation can follow separately.

## Not extracted

`relay/src/webhooks/meta.ts` — Cloudflare Workers runtime, can't import the Express-based
webhook-runtime. (It also lacks the `SAFE_CHALLENGE_RE` whitelist — a latent inconsistency,
flagged but out of scope.)

## Release prerequisite

Publish `@mulmobridge/webhook-runtime@1.0.0` to npm before any consumer bridge is next
published, or `^1.0.0` can't resolve against npm's `0.1.0`.

## Verify

format / lint (0 new) / typecheck / build / webhook-runtime tests 24 / common tests 11 /
deps / drift / smoke / launcher-sync — all green.
