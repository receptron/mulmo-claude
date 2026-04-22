# feat: more bridges (Mastodon, Bluesky, Chatwork, XMPP, Rocket.Chat, Signal, Teams, Webhook, Twilio SMS, Email, LINE Works, Nostr, Viber)

## Goal

Expand MulmoBridge from the original 12 messaging platforms to cover more user populations, in priority order of (1) ease of implementation, (2) usability, (3) user base. Ship each with a "standard" feature set and iterate on user feedback.

## Order

### Batches A–D — chat platforms (tracked in #606)

| # | Package | Connection | Public URL | Batch |
|---|---|---|---|---|
| 1 | `@mulmobridge/mastodon` | WebSocket streaming + REST (outbound) | No | A (#607) |
| 2 | `@mulmobridge/bluesky` | chat.bsky getLog polling (outbound) | No | A (#607) |
| 3 | `@mulmobridge/chatwork` | Long-polling REST (outbound) | No | B (#609) |
| 4 | `@mulmobridge/xmpp` | XMPP over TLS (outbound) | No | B (#609) |
| 5 | `@mulmobridge/rocketchat` | REST polling (outbound) | No | C (#611) |
| 6 | `@mulmobridge/signal` | signal-cli-rest-api WS+REST (outbound daemon) | No | C (#611) |
| 7 | `@mulmobridge/teams` | Bot Framework SDK (webhook) | Yes | D (#614) |

### Batches E–F — universal glue, regional, emerging protocols

| # | Package | Connection | Public URL | Batch |
|---|---|---|---|---|
| 8 | `@mulmobridge/webhook` | Generic HTTP POST → JSON reply | localhost-only | E (#619) |
| 9 | `@mulmobridge/twilio-sms` | Twilio webhook + REST (HMAC-SHA1 sig) | Yes | E (#619) |
| 10 | `@mulmobridge/email` | IMAP poll + SMTP send | No | E (#619) |
| 11 | `@mulmobridge/line-works` | Service-account JWT → OAuth + webhook | Yes | F (#622) |
| 12 | `@mulmobridge/nostr` | Relay WebSockets + NIP-04 encrypted DM | No | F (#622) |
| 13 | `@mulmobridge/viber` | Webhook + REST (HMAC-SHA256 sig) | Yes | F (#622) |

Teams got its own PR because Azure AD setup dwarfs the code; every other batch bundles two packages.

## Standard feature set

Every new bridge ships with:

- `TRANSPORT_ID` matching the package name (e.g., `mastodon`)
- `dotenv/config` for env-based config
- `createBridgeClient` + `chunkText` from `@mulmobridge/client`
- Per-platform text length chunking at the platform's native limit
- Allowlist via env var CSV (e.g., `MASTODON_ALLOWED_ACCTS=user@instance,…`). Empty → allow all
- Image attachment forwarding where the platform provides URLs (re-fetch + base64 encode, pass as `attachments[]`)
- Outbound-only connection where the platform allows it; webhook-required bridges document tunnel setup
- `onPush` handler wired to platform send API
- Standard error logging with bridge prefix
- README.md with setup + troubleshooting + security note sections, mirroring existing bridges
- `tsconfig.json` extending `../../../config/tsconfig.packages.json`
- Listed in root `package.json` `build:packages`, `packages/README.md` table, `docs/mulmobridge-guide.*` guides, `docs/CHANGELOG.md` Unreleased

## Scope decisions (defaults)

- **DM-only** where DMs exist as a distinct concept (Mastodon, Bluesky, Rocket.Chat, Signal, Teams, Nostr, LINE Works, Viber). Mention / channel handling deferred to follow-ups based on feedback.
- **Direct `fetch` + `ws`** over SDKs where the API is simple REST + WebSocket (Mastodon, Chatwork, Rocket.Chat, Signal, Twilio, Viber, LINE Works, Email SMTP). Official SDKs adopted when signing / protocol complexity justifies it (Bluesky pattern via direct XRPC, XMPP → `@xmpp/client`, Teams → `botbuilder`, Nostr → `nostr-tools`, Email IMAP → `imapflow`, Email parsing → `mailparser`, Email SMTP → `nodemailer`).
- **No attachment upload back** to the platform in v0.1.0 — only receiving images from user → forwarding to MulmoClaude. Bot→platform image sends deferred.
- **No persistence** — bridges are stateless, matching the rest of the fleet.

## Milestones

- [x] Plan doc committed (this file)
- [x] Issue #606 opened (meta, tracks all batches A–F)
- [x] Batch A: Mastodon + Bluesky — #607
- [x] Batch B: Chatwork + XMPP — #609
- [x] Batch C: Rocket.Chat + Signal — #611
- [x] Batch D: Teams — #614
- [x] Batch E: Webhook + Twilio SMS + Email — #619
- [x] Batch F: LINE Works + Nostr + Viber — #622

## Scope changes vs. original plan

- **Batch F swap: KakaoTalk → Viber.** The KakaoTalk Skill Server webhook has a hard 5 s reply timeout (the bot must return the full response in the HTTP body within 5 s), which is incompatible with multi-minute MulmoClaude turns. Kakao i OpenBuilder has an async callback extension but needs a distinct design pass — deferred to v0.2. Viber filled the slot with similar geographic reach (E. Europe / SEA) and a much cleaner async API.

## Follow-up candidates (not in scope for this plan)

- **KakaoTalk** via Kakao i OpenBuilder async callback
- **Facebook / Meta Workplace** (if the API is still accessible)
- **Lark / Feishu / DingTalk** for the Chinese enterprise market
- **WeChat Official Account** (heavy reviewer setup)
- **GitHub Issues / GitLab MR comments / Jira / Linear** as dev-facing bridges
- **Twilio Voice (+ STT + TTS)** for phone-call-to-AI
- **Discord voice channel** similar use case
- **Relay plugins** for webhook-required bridges (Teams, LINE Works, Viber, Twilio SMS) — gives users a tunnel-free path via Cloudflare Workers, paralleling what relay already does for LINE / WhatsApp / Messenger / Google Chat

## Open questions (resolve during follow-up batches, not blockers)

- **Multi-account**: users who want both their personal and work accounts simultaneously. Answer: run two bridge processes with different `TRANSPORT_ID` overrides. Document.
- **Rate-limit backoff**: current bridges mostly assume best-effort. Re-examine when we hit one in production.
- **Mention / channel / group expansion**: DM-only defaults get the feedback loop started; broaden based on actual requests.
