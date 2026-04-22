# @mulmobridge/mastodon

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Mastodon bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Subscribes to your bot account's streaming notifications and forwards DMs (and optionally public mentions) to MulmoClaude. Outbound-only WebSocket — **no public URL / tunnel / relay needed**.

## Setup

### 1. Create a bot account + access token

1. Sign up or log into a Mastodon instance (e.g. `mastodon.social`). A dedicated bot account is recommended.
2. Go to **Preferences → Development → New application**.
3. Name it (e.g. `MulmoClaude`). Required scopes: `read`, `write`, `push`.
4. Copy the **Access token** shown after creating the application.

### 2. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
MASTODON_INSTANCE_URL=https://mastodon.social \
MASTODON_ACCESS_TOKEN=... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/mastodon

# With real MulmoClaude
MASTODON_INSTANCE_URL=https://mastodon.social \
MASTODON_ACCESS_TOKEN=... \
npx @mulmobridge/mastodon
```

Send a DM (`visibility: direct`) to the bot account from another account — you'll get a reply.

## Environment variables

| Variable                   | Required | Default | Description |
|----------------------------|----------|---------|-------------|
| `MASTODON_INSTANCE_URL`    | yes      | —       | Instance base URL, e.g. `https://mastodon.social` |
| `MASTODON_ACCESS_TOKEN`    | yes      | —       | Bot account access token (from Preferences → Development) |
| `MASTODON_ALLOWED_ACCTS`   | no       | (all)   | CSV of `acct` strings allowed to converse — e.g. `alice@mastodon.social,bob@mstdn.jp`. Empty = accept everyone |
| `MASTODON_DM_ONLY`         | no       | `true`  | `true` only processes `direct`-visibility statuses; `false` also handles public / unlisted mentions |
| `MULMOCLAUDE_AUTH_TOKEN`   | no       | auto    | Override for the MulmoClaude bearer token (auto-read from `~/mulmoclaude/.session-token` otherwise) |
| `MULMOCLAUDE_API_URL`      | no       | `http://localhost:3001` | MulmoClaude server URL |

## How it works

1. The bridge opens a WebSocket to `/api/v1/streaming?stream=user:notification` with your access token.
2. When the bot receives a mention notification, the bridge checks the `visibility` (DM-only filter) and the `acct` (allowlist), strips HTML + leading `@bot` tokens from the status content, fetches any image attachments, and forwards the message to MulmoClaude with the sender's `acct` as `externalChatId`.
3. MulmoClaude's reply is posted back as a status with `in_reply_to_id` pointing at the original status and the same `visibility` — so a DM stays a DM, a public mention replies publicly.
4. Long replies are chunked at 500 chars (Mastodon's default — many instances raise this; 500 is the safe floor).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `MASTODON_INSTANCE_URL and MASTODON_ACCESS_TOKEN are required` | env vars missing | Export them or add to `.env` |
| `[mastodon] stream error: 401` | token invalid / revoked | Regenerate the access token in Preferences → Development |
| Messages silently ignored | `MASTODON_DM_ONLY=true` and status is public | Set `MASTODON_DM_ONLY=false` or DM the bot instead of mentioning |
| Bridge reconnects in a loop | instance WebSocket disabled | Some instances disable streaming; use a different instance or run locally |

## Security notes

- The access token grants full read + write + push to the bot account. Treat like a password.
- Bot accounts are best created as separate accounts — revoking the token won't affect your main identity.
- Allowlisting via `MASTODON_ALLOWED_ACCTS` is recommended for personal agents. Without it, anyone who mentions the bot will get a reply.
- Image attachments are re-fetched from Mastodon's media CDN, base64 encoded, and forwarded to MulmoClaude. They don't transit any third party.
