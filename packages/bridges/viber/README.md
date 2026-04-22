# @mulmobridge/viber

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

[Viber](https://www.viber.com/) Public Account chatbot bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Receives user messages via HTTPS webhook, replies via the Viber Bot REST API. Popular in Eastern Europe, Southeast Asia, and parts of the Middle East.

**Public URL required** (Viber only supports webhook delivery).

## Setup

### 1. Create a Public Account (Bot)

1. Open Viber app → **More → Public Accounts → Create Account**.
2. Complete the onboarding; pick a category.
3. On the admin panel ([partners.viber.com](https://partners.viber.com/)) → **Your Account → Edit Info → Chatbot / Subscribe Bot** → copy the **Authentication Token**.

### 2. Expose the bridge

```bash
ngrok http 3012
# → https://abcd.ngrok-free.app
```

### 3. Set the webhook

Once you have the public URL, register it with Viber. Either via the admin panel, or via a one-off HTTP call:

```bash
curl -X POST https://chatapi.viber.com/pa/set_webhook \
  -H "X-Viber-Auth-Token: <VIBER_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://abcd.ngrok-free.app/viber","event_types":["message"]}'
```

### 4. Run the bridge

```bash
VIBER_AUTH_TOKEN=... \
npx @mulmobridge/viber
```

Send a message to your Public Account from the Viber app — you'll get a reply.

## Environment variables

| Variable               | Required | Default         | Description |
|------------------------|----------|-----------------|-------------|
| `VIBER_AUTH_TOKEN`     | yes      | —               | Public Account auth token from the admin panel |
| `VIBER_SENDER_NAME`    | no       | `MulmoClaude`   | Display name used on outbound messages |
| `VIBER_WEBHOOK_PORT`   | no       | `3012`          | HTTP port |
| `VIBER_ALLOWED_USERS`  | no       | (all)           | CSV of Viber user IDs allowed (empty = everyone who messages the bot) |
| `MULMOCLAUDE_AUTH_TOKEN` | no     | auto            | MulmoClaude bearer token override |
| `MULMOCLAUDE_API_URL`  | no       | `http://localhost:3001` | MulmoClaude server URL |

## How it works

1. Viber POSTs event JSON to `/viber` with an `X-Viber-Content-Signature` header (HMAC-SHA256 of the raw body keyed on the auth token).
2. The bridge verifies the signature in constant time and ACKs `200` immediately so Viber doesn't retry.
3. For `event:"message"` with `message.type === "text"`, the bridge runs the allowlist, then forwards `message.text` to MulmoClaude keyed by `sender.id`.
4. Replies go out via `POST /pa/send_message` with the auth token in the `X-Viber-Auth-Token` header. Chunked at 7 000 chars.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Webhook registration returns `{"status":10,"status_message":"No URL parameter supplied."}` | Typo in set_webhook call | Re-check JSON body |
| Invalid signature on all events | Rotation mismatch between `VIBER_AUTH_TOKEN` and the token used to register the webhook | Re-register the webhook using the current token |
| `send non-zero status: {"status":6,…}` | Receiver hasn't messaged your bot first | Viber requires the user to start the conversation before you can push to them |

## Security notes

- The auth token is both the bot's identity and the webhook signing key — rotate it via the admin panel if it leaks.
- `VIBER_ALLOWED_USERS` is recommended. Without it, anyone who finds your Public Account can chat with your agent.
- Viber's chat history is controlled by the Viber app — the bridge itself keeps no local message log.
