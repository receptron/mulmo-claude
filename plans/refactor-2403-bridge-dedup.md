# refactor #2403 — Phase-3 dedup: bridge↔bridge and bridge↔relay clones

Issue: #2403. Phase-3 dedup target list (jscpd 186/90/80/80/73/66 tokens).

## Duplication map & chosen home

| Clone pair | Duplicated logic | Shared home | Runtime |
|---|---|---|---|
| `bridges/messenger` ↔ `relay/webhooks/messenger.ts` (186tok) | Meta Messenger payload parser (`parseOneEvent`/`extractMessages`) | `@mulmoclaude/common/meta-webhook` (new) | isomorphic (Node + Workers) |
| `bridges/whatsapp` ↔ `relay/webhooks/whatsapp.ts` (90tok) | WhatsApp Cloud payload parser (`parseOneWaMessage`/`extract`) | `@mulmoclaude/common/meta-webhook` (new) | isomorphic |
| `bridges/messenger` ↔ `bridges/whatsapp` (73tok) | Meta webhook GET `hub.challenge` verification handler + `sha256=` HMAC strip | `@mulmobridge/webhook-runtime` (existing) | Node/Express |
| `bridges/rocketchat` ↔ `bridges/zulip` (80tok ×2) | REST JSON fetch skeleton (`fetch` → `!res.ok` throw → `isRecord` narrow) | `@mulmobridge/client` (existing) | Node |
| `bridges/mastodon` ↔ `bridges/signal` (66tok) | `ws` frame → utf8 string decoder (`frameText`) | `@mulmobridge/client` (existing) | Node |

## Critical runtime-compat constraint

The relay runs on Cloudflare Workers (Web Crypto / `crypto.subtle`, `fetch`); the bridges run on Node/Express (`node:crypto`, Express). So bridge↔relay shared code MUST be runtime-agnostic:

- The Meta **HMAC signature verification** is NOT shared bridge↔relay: relay uses `crypto.subtle` (`meta.ts`), bridges use `node:crypto` (`verifyHmacSignature`). Left as-is.
- Only the **pure payload parsers** (no crypto, no I/O, `isRecord`-only) are shared bridge↔relay. `@mulmoclaude/common` is the right home: zero-dep leaf, already a dependency of both the messenger/whatsapp bridges and the relay, and it already owns `isRecord`. No Node APIs used in the new module → Workers-safe.
- `frameText` (Node `Buffer`) and `fetchJsonRecord` (I/O) are bridge↔bridge only → `@mulmobridge/client` (the shared bridge lib), NOT `@mulmoclaude/common` (kept browser/Worker-safe & pure).

## Pure-logic extraction + tests

- `@mulmoclaude/common/meta-webhook`: `extractMessengerMessages`, `extractWhatsAppMessages` (+ types). Pure. `test/test_meta_webhook.ts`.
- `@mulmobridge/webhook-runtime`: `metaVerificationResult(query, verifyToken)` pure decision fn used by the Express `registerMetaWebhookVerification(...)` I/O wrapper; `verifyMetaHmacSignature(rawBody, signature, appSecret)`. Extend `test/test_webhook-runtime.ts`.
- `@mulmobridge/client`: `frameText(data)` pure; `asJsonRecord(json)` pure narrower used by `fetchJsonRecord(url, init, errorLabel)` I/O wrapper. `test/test_frame.ts`, `test/test_http.ts`.

## Version discipline (bump-once-at-publish)

Per the standing policy, shared-package `version` fields are NOT bumped per-PR and consumer ranges are NOT swept per-PR — that happens once, at publish time. This PR is **code + tests + docs only**: no `version` change to `@mulmoclaude/common`, `@mulmobridge/webhook-runtime`, or `@mulmobridge/client`, and no consumer range churn. Workspace resolution ignores the version number for internal imports, so the new `@mulmoclaude/common/meta-webhook` subpath and the other additions resolve at the unchanged versions.

- Only two non-version package.json edits are kept: the `@mulmoclaude/common/meta-webhook` export-map entry (common), and the `@mulmobridge/client` → `@mulmoclaude/common` dep edge (range `^1.1.0`, matching every other consumer — needed for `isRecord`).

## Docs

`docs/shared-utils.md` + 1-line entries for each new helper; `docs/CHANGELOG.md` entry.

## Out of scope

Spreadsheet code (untouched). Mastodon SSRF/`request-forgery` CodeQL alert at `mastodon/src/index.ts:166` is in `fetchImageAttachment` — the only mastodon change here is extracting `frameText` (WS decode, unrelated to that fetch), so the alert surface is untouched.

## Verify

`yarn format`, `yarn lint`, `yarn typecheck`, `yarn build`, `yarn check:launcher-sync`, and the affected packages' `yarn test`.
