# @mulmobridge/line-works

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

[LINE Works](https://line.worksmobile.com/) (enterprise LINE) bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Note: LINE Works is a **separate product** from consumer LINE — use [@mulmobridge/line](../line/) for the consumer app.

**Public URL required** (LINE Works uses webhook delivery).

## Setup

### 1. Register a Bot in Developer Console

1. Go to [Developer Console](https://dev.worksmobile.com/console/) (admin account needed).
2. **API 2.0 → Applications → Create** — note the **Client ID** and **Client Secret**.
3. **Service Account** — create one; note the ID (looks like `abc.serviceaccount@yourdomain`).
4. **Private Key** — generate and download the PEM. Store it safely.
5. Grant the app the scopes **`bot`** and **`bot.message`**.
6. **Bot** → Create → note the numeric **Bot ID** and generate a **Bot secret**.
7. Add your bot to the domain's Bot Directory so members can message it.

### 2. Expose the bridge

```bash
ngrok http 3013
# → https://abcd.ngrok-free.app
```

### 3. Set the callback URL

In the Developer Console → Bot → **Callback URL**: `https://abcd.ngrok-free.app/callback`.
Toggle on the `Message` event.

### 4. Run the bridge

```bash
LINEWORKS_CLIENT_ID=... \
LINEWORKS_CLIENT_SECRET=... \
LINEWORKS_SERVICE_ACCOUNT=abc.serviceaccount@yourdomain \
LINEWORKS_BOT_ID=1234567 \
LINEWORKS_BOT_SECRET=... \
LINEWORKS_PRIVATE_KEY_FILE=./private_key.pem \
npx @mulmobridge/line-works
```

Send the bot a direct message in LINE Works — you'll get a reply.

## Environment variables

| Variable                       | Required | Default | Description |
|--------------------------------|----------|---------|-------------|
| `LINEWORKS_CLIENT_ID`          | yes      | —       | App Client ID |
| `LINEWORKS_CLIENT_SECRET`      | yes      | —       | App Client Secret |
| `LINEWORKS_SERVICE_ACCOUNT`    | yes      | —       | Service account ID |
| `LINEWORKS_BOT_ID`             | yes      | —       | Numeric Bot ID |
| `LINEWORKS_BOT_SECRET`         | yes      | —       | Per-bot secret (used to verify `X-WORKS-Signature` on webhooks) |
| `LINEWORKS_PRIVATE_KEY`        | either   | —       | PEM string (use `\n` for newlines when putting on a single env line) |
| `LINEWORKS_PRIVATE_KEY_FILE`   | either   | —       | Path to PEM file (alternative to inline env) |
| `LINEWORKS_WEBHOOK_PORT`       | no       | `3013`  | HTTP port |
| `LINEWORKS_ALLOWED_USERS`      | no       | (all)   | CSV of sender `userId`s allowed |
| `MULMOCLAUDE_AUTH_TOKEN`       | no       | auto    | MulmoClaude bearer token override |
| `MULMOCLAUDE_API_URL`          | no       | `http://localhost:3001` | MulmoClaude server URL |

## How it works

1. On startup, the bridge caches a JWT assertion signed with the service account private key (RS256).
2. When an API call is needed, it exchanges the assertion for an OAuth access token at `https://auth.worksmobile.com/oauth2/v2.0/token` (grant type `jwt-bearer`, scopes `bot bot.message`). The token is cached until ~60 s before expiry.
3. LINE Works POSTs events to `/callback` with `X-WORKS-Signature` (HMAC-SHA256 of the raw body, base64 encoded) keyed on the per-bot secret. The bridge verifies constant-time, ACKs `200` immediately.
4. For `type=message` + text content, the bridge runs the allowlist, forwards the text to MulmoClaude keyed on `source.userId`, and replies via `POST /v1.0/bots/{botId}/users/{userId}/messages`. Replies are chunked at 1 000 chars (LINE Works' per-message limit is ~1000 for text).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `token: 400 invalid_grant` | Private key doesn't match the service account | Re-download the PEM for the exact service account ID |
| `token: 401 invalid_client` | Client ID / secret wrong | Regenerate in Developer Console |
| Webhook never arrives | Callback URL not HTTPS or event types unchecked | Set HTTPS URL; enable `Message` event type |
| `send failed: 403` | Scope missing | Add `bot` + `bot.message` to the app and reauthorize |

## Security notes

- Four secrets: Client Secret, Bot Secret, Service Account Private Key, Access Token. Treat each like a password. Rotate the private key via Developer Console on any suspected leak.
- LINE Works is domain-scoped. A bot only reaches users inside its domain — no accidental external exposure.
- Use `LINEWORKS_ALLOWED_USERS` to limit which domain members can converse with the agent, especially for personal-data rooms.
- Group / channel messaging is not implemented in v0.1.0 — 1:1 only.
