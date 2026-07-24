# feat: @mulmobridge/webhook-runtime — shared webhook plumbing for bridges

Issue: #2147

## Context

Third dedup PR after #2141 / #2145. jscpd flagged 14 clone pairs among
`packages/bridges/*/index.ts`. Unlike the vite.config / i18n noise, these
are genuine security-relevant duplication: six inbound-webhook bridges
(LINE, WhatsApp, Viber, LINE WORKS, Messenger, Google Chat) each inlined
the same `BRIDGE_TRUST_PROXY` parse, IPv6-safe rate limit, timing-safe
HMAC check and Express setup — all hardened through Codex reviews (#1326).
Six copies = a security fix has to land six times.

## Design

New leaf package `@mulmobridge/webhook-runtime` (build tier 1, deps:
express + express-rate-limit only):

- `createWebhookApp({ bodyLimit? })` — `express()` + `disable("x-powered-by")`
  + `configureTrustProxy` + `express.text({ type, limit })`.
- `configureTrustProxy(app, env?)` — the `BRIDGE_TRUST_PROXY` boolean/hop/
  CIDR parse (nested ternary lifted into `parseTrustProxyValue`).
- `createWebhookRateLimit(limitPerMinute?)` — the 120/min IPv6-safe limiter.
- `verifyHmacSignature(body, sig, secret, algorithm?, encoding?)` — the
  length-guarded timing-safe compare; `encoding` covers LINE base64 vs
  Meta hex.

Placed under `packages/webhook-runtime/` (NOT `packages/bridges/`, which
is auto-discovered as build tier 3) and added to the explicit tier-1
enumeration in root `package.json` (`build:packages` + `build:packages:dev`).

## Migration (6 bridges)

- HMAC bridges call `verifyHmacSignature`. Meta ones (WhatsApp, Messenger)
  keep a 1-line wrapper that strips the `sha256=` prefix.
- `bodyLimit: "1mb"` preserved for Viber / LINE WORKS / Messenger; the
  others keep Express's 100kb default (undefined `limit`).
- Google Chat verifies an RSA JWT in the Authorization header and parses
  the body with `express.json`, so it only adopts `configureTrustProxy`
  + `createWebhookRateLimit` (NOT `createWebhookApp`'s text parser).

## Deliberately NOT extracted

- `readRequiredEnv` — each bridge validates different env-var names; a
  generic reader would hide the names that matter for the error message.
- Meta `hub.challenge` GET verification — only 2 bridges, Meta-specific.

## Result

jscpd bridge clone pairs 14 → 6 (largest 154t → 73t); the remainder is
the bridge-specific env/verification code left in place. `yarn
build:packages` exits 0 with webhook-runtime built in tier 1 ahead of the
bridges that consume it.

## Verification

- webhook-runtime unit tests 11/11 (HMAC accept/reject/length/hex,
  trust-proxy true/false/hop/CIDR, factory shapes).
- Each bridge builds + lints clean; full `build:packages` green.
- docs/shared-utils.md + docs/build-orchestration.md updated.
