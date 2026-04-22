# @mulmobridge/rocketchat

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Rocket.Chat bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Polls each of the bot user's direct-message rooms via the Rocket.Chat REST API, forwards new messages to MulmoClaude, and posts replies back. Outbound-only — **no public URL needed**.

## Setup

### 1. Create a bot user

On a server you own (e.g. a self-hosted Rocket.Chat), create a dedicated user for the bot. Public SaaS accounts work too.

### 2. Generate a personal access token

Log into Rocket.Chat **as the bot user** (or any account you want the bridge to impersonate) →

1. Avatar → **My Account → Personal Access Tokens**
2. **Add** — uncheck "Ignore Two Factor Authentication" for safety
3. Copy the **Token** and **User ID** (shown only once)

### 3. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
ROCKETCHAT_URL=https://rocket.example.com \
ROCKETCHAT_USER_ID=... \
ROCKETCHAT_TOKEN=... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/rocketchat

# With real MulmoClaude
ROCKETCHAT_URL=https://rocket.example.com \
ROCKETCHAT_USER_ID=... \
ROCKETCHAT_TOKEN=... \
npx @mulmobridge/rocketchat
```

DM the bot user from another Rocket.Chat account and you'll get a reply.

## Environment variables

| Variable                       | Required | Default | Description |
|--------------------------------|----------|---------|-------------|
| `ROCKETCHAT_URL`               | yes      | —       | Server URL, e.g. `https://rocket.example.com` |
| `ROCKETCHAT_USER_ID`           | yes      | —       | Bot user ID (from Personal Access Tokens page) |
| `ROCKETCHAT_TOKEN`             | yes      | —       | Personal access token |
| `ROCKETCHAT_ALLOWED_USERS`     | no       | (all)   | CSV of usernames (without `@`) allowed to converse — empty = everyone |
| `ROCKETCHAT_POLL_INTERVAL_SEC` | no       | `5`     | Poll interval in seconds (min 2) |
| `MULMOCLAUDE_AUTH_TOKEN`       | no       | auto    | MulmoClaude bearer token override |
| `MULMOCLAUDE_API_URL`          | no       | `http://localhost:3001` | MulmoClaude server URL |

## How it works

1. On startup the bridge calls `GET /api/v1/me` to confirm the token works.
2. Every `ROCKETCHAT_POLL_INTERVAL_SEC` it lists the bot's DM rooms via `GET /api/v1/im.list` and, per room, fetches messages newer than a cached cursor via `GET /api/v1/im.history?roomId=...&oldest=<iso>`.
3. For each new message not authored by the bot (and whose sender is in the allowlist if set), the bridge forwards the text to MulmoClaude keyed by `roomId`.
4. Replies go back via `POST /api/v1/chat.postMessage`, chunked at 4 000 chars.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `GET /me: 401` | wrong user ID or token | Regenerate from Personal Access Tokens |
| `POST /chat.postMessage: 400` | room doesn't exist or bot not in it | DM the bot user at least once so the DM room is created |
| Messages silently ignored | Sender not in `ROCKETCHAT_ALLOWED_USERS` | Add their username or clear the env var |
| Rate-limit errors on large deploys | Many DM rooms × short poll interval | Raise `ROCKETCHAT_POLL_INTERVAL_SEC` |

## Security notes

- The personal access token grants full read/write as the bot user. Treat like a password.
- A dedicated bot account is strongly recommended — don't reuse your personal account.
- Without `ROCKETCHAT_ALLOWED_USERS`, anyone with an account on the server who DMs the bot will get a reply. Set an allowlist for personal agents.
- This v0.1.0 polls the REST API only. Future releases may add the realtime (DDP) websocket for push delivery.
