# refactor(relay): collapse duplicated webhook skeletons (#2402)

## Problem

Inside `packages/relay/src/webhooks/` two platform pairs carry byte-identical
skeletons that jscpd flags (127/79/72/65/54/54/52 tokens, 7 blocks):

- **google-chat ↔ teams** — the inbound Bearer-JWT auth path: `b64UrlDecode`,
  `parseJwt` (+ its `ParsedJwt` type), and the RSA `crypto.subtle` signature
  check (alg→hash mapping → `importKey` → `verify`) are duplicated verbatim.
- **messenger ↔ whatsapp** — the Meta signature gate (`x-hub-signature-256`
  read → HMAC verify → labelled throw) and the `handleWebhook` skeleton
  (build `RelayMessage[]` from the extracted events).
- The outbound reply loop (chunk → authenticated JSON POST → network-error
  wrapper → non-2xx detail throw) is duplicated across **messenger, whatsapp
  and teams**.

These are security boundaries (JWT/HMAC verification, challenge/response), so a
copy-paste-per-new-platform culture is where a laxer new copy slips in — the
exact risk #2402 calls out. #2147 already pulled the *Node bridge* webhook
plumbing into `@mulmobridge/webhook-runtime`; these relay copies were missed.

## Canonical home

`@mulmobridge/webhook-runtime` is **Node/Express** (imports `crypto`,
`express`, `express-rate-limit`) and serves the `packages/bridges/*` bridges.
The relay is a **Cloudflare Worker** (Web Crypto `crypto.subtle`, `fetch`, no
Node built-ins), so it cannot import that package. The correct home is a
**relay-internal shared module** under `packages/relay/src/webhooks/`, matching
the existing split style (`teams-verify.ts`, `meta.ts`). Dependency direction
is respected — everything stays inside the relay package; no uphill or
cross-package imports are introduced.

## Shared API (new / extended files)

- `webhooks/jwt.ts` (new) — `b64UrlDecode`, `ParsedJwt`, `parseJwt`, `jwtKid`,
  `jwtHashAlg` (all pure), and `verifyJwtSignature(jwt, jwk)` (Web Crypto).
  Each platform keeps its own claim validation and JWKS fetch/cache (the caches
  genuinely differ: google-chat has a single global cache; teams has a per-URL
  `Map` plus `msteams` endorsement filtering) — only the parse + verify move.
- `webhooks/respond.ts` (new) — `postJsonChunks({ text, maxTextLength, label,
  endpoint, accessToken, buildBody })`: the chunked authenticated-POST loop
  with the network-error and non-2xx-detail wording. Used by messenger,
  whatsapp, teams.
- `webhooks/relay-message.ts` (new) — `makeRelayMessage({ platform, senderId,
  chatId, text, replyToken? })`: the `RelayMessage` envelope factory. Omits
  `replyToken` when absent so the forwarded JSON is byte-identical to the
  previous per-platform literals.
- `webhooks/meta.ts` (extend) — `verifyMetaWebhookSignature(request, body,
  appSecret, label)`: the shared Meta inbound signature gate.

## Migration

- `google-chat.ts` / `teams.ts` — import from `jwt.ts`; drop local
  `b64UrlDecode` / `parseJwt` / `ParsedJwt`; call `jwtKid` + `verifyJwtSignature`
  in the verify function (teams keeps its endorsement check between key lookup
  and verify). Use `makeRelayMessage`.
- `messenger.ts` / `whatsapp.ts` — call `verifyMetaWebhookSignature` then
  `makeRelayMessage`; teams/messenger/whatsapp `sendResponse` call
  `postJsonChunks`.
- **google-chat `sendResponse` is intentionally left inline**: it is the only
  send loop that omits the response-body detail from its error message, so
  folding it into `postJsonChunks` would change its thrown-error text. Behavior
  parity wins over deduping the last copy.

## Behavior

Identical. All extractions are verbatim moves / parameterisations; no control
flow, no error wording (for the migrated three), no message shape changes.

## Tests

`test/test_webhook_shared.ts` (node:test) covering the pure logic:
`b64UrlDecode` (padded / unpadded / url-safe chars / empty), `parseJwt`
(happy / wrong segment count / non-base64 / non-JSON), `jwtHashAlg` (absent alg
→ SHA-256, RS256/384/512, unknown → SHA-512), `makeRelayMessage` (field
mapping, `replyToken` present only when supplied), and `postJsonChunks`
(success, network-error wording, non-2xx detail wording) via a stubbed `fetch`.
Existing `test_google_chat_webhook.ts` / `test_teams_webhook.ts` claim
validators stay green.

## Verify

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn test`.
