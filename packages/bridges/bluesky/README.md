# @mulmobridge/bluesky

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Bluesky bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Speaks the `chat.bsky.convo.*` XRPC API (Bluesky Direct Messages) via your PDS with the `atproto-proxy` header. Polls for new message events every few seconds — outbound-only, **no public URL needed**.

## Setup

### 1. Create an app password

1. Log into [bsky.app](https://bsky.app) as the account you want to use as the bot (a dedicated bot handle is recommended).
2. Go to **Settings → Privacy and security → App Passwords → Add App Password**.
3. Name it (e.g. `MulmoClaude`). Copy the password — you won't see it again.

> Note: app passwords now require opting in to chat access during creation. Ensure the "Allow access to your direct messages" toggle is **on**.

### 2. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
BLUESKY_HANDLE=mulmobot.bsky.social \
BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/bluesky

# With real MulmoClaude
BLUESKY_HANDLE=mulmobot.bsky.social \
BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
npx @mulmobridge/bluesky
```

Send a DM to the bot account from another Bluesky account — you'll get a reply.

## Environment variables

| Variable                 | Required | Default                  | Description |
|--------------------------|----------|--------------------------|-------------|
| `BLUESKY_HANDLE`         | yes      | —                        | Bot handle, e.g. `mulmobot.bsky.social` |
| `BLUESKY_APP_PASSWORD`   | yes      | —                        | App password with chat access enabled |
| `BLUESKY_SERVICE`        | no       | `https://bsky.social`    | PDS URL (override only for third-party PDSes) |
| `BLUESKY_ALLOWED_DIDS`   | no       | (all)                    | CSV of DIDs allowed to converse — e.g. `did:plc:abc123,did:plc:def456`. Empty = accept everyone |
| `MULMOCLAUDE_AUTH_TOKEN` | no       | auto                     | Override for the MulmoClaude bearer token |
| `MULMOCLAUDE_API_URL`    | no       | `http://localhost:3001`  | MulmoClaude server URL |

## How it works

1. The bridge logs into the bot's PDS with the app password (`com.atproto.server.createSession`), gets an `accessJwt` + `refreshJwt`, and caches them. Expired access tokens are refreshed transparently on 401.
2. Every ~3 s it calls `chat.bsky.convo.getLog` (with the `atproto-proxy: did:web:api.bsky.chat#bsky_chat` header) and processes any `logCreateMessage` entries whose sender isn't the bot itself.
3. The sender's DID is checked against the allowlist (if configured), the message text is forwarded to MulmoClaude with `convoId` as the `externalChatId`, and the reply is sent via `chat.bsky.convo.sendMessage`.
4. Long replies are chunked at 10 000 chars (Bluesky's DM limit).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `createSession failed: 401` | wrong handle or app password | Double-check handle (include `.bsky.social`) and regenerate the app password |
| `chat.bsky.convo.getLog: 403` | app password lacks chat access | Delete and recreate the app password with "Allow access to your direct messages" enabled |
| Bot replies to itself | unlikely — we filter on `sender.did === selfDid`, but if you see it, open an issue | — |
| Messages silently ignored | DID not in `BLUESKY_ALLOWED_DIDS` | Add it to the allowlist, or unset the env var to allow all |

## Security notes

- App passwords are scoped to the bot account only — they can't see or post from your main account. Still, treat like a password.
- A dedicated bot account is strongly recommended; reuse of a personal account means DMs to you become bot-processable.
- Allowlisting via `BLUESKY_ALLOWED_DIDS` is recommended for personal agents. Without it, anyone who DMs the bot can converse with your MulmoClaude.
- No image / embed forwarding in this version — DMs with attachments are delivered as text-only to MulmoClaude. Image support may land in a follow-up once Bluesky DMs officially support media.
