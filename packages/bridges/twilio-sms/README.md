# @mulmobridge/twilio-sms

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

SMS bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude) via [Twilio Programmable Messaging](https://www.twilio.com/messaging). Every phone on Earth can text your AI agent — no app install needed.

**Public URL required** (Twilio posts a webhook every time an SMS arrives on your number).

## Setup

### 1. Get a Twilio number

1. Sign up at [twilio.com](https://www.twilio.com/) (trial includes credits).
2. **Phone Numbers → Buy a Number** → pick one with SMS capability.
3. Note the **Account SID** + **Auth Token** (Twilio console top-right / Settings → General).

### 2. Expose the bridge with a tunnel

```bash
ngrok http 3010
# copy the https URL — e.g. https://abcd.ngrok-free.app
```

### 3. Configure the Twilio number

In the Twilio console, open the number → **Messaging → A Message Comes In** → Webhook, method **HTTP POST** → URL `https://<your-tunnel>/sms`.

### 4. Run the bridge

```bash
TWILIO_ACCOUNT_SID=AC... \
TWILIO_AUTH_TOKEN=... \
TWILIO_FROM_NUMBER=+15551234567 \
TWILIO_PUBLIC_URL=https://abcd.ngrok-free.app \
npx @mulmobridge/twilio-sms
```

Text the Twilio number — you'll get a reply.

## Environment variables

| Variable                 | Required    | Default | Description |
|--------------------------|-------------|---------|-------------|
| `TWILIO_ACCOUNT_SID`     | yes         | —       | Twilio Account SID |
| `TWILIO_AUTH_TOKEN`      | yes         | —       | Twilio Auth Token (used for REST + signature verification) |
| `TWILIO_FROM_NUMBER`     | yes         | —       | Your Twilio number in E.164, e.g. `+15551234567` |
| `TWILIO_WEBHOOK_PORT`    | no          | `3010`  | HTTP port |
| `TWILIO_PUBLIC_URL`      | recommended | —       | Full public URL of the `/sms` endpoint (e.g. `https://abcd.ngrok-free.app`). Required to verify Twilio's `X-Twilio-Signature`. Without it, signature verification is skipped with a warning (dev-only). |
| `TWILIO_ALLOWED_NUMBERS` | no          | (all)   | CSV of sender E.164 numbers allowed (empty = accept every number) |
| `MULMOCLAUDE_AUTH_TOKEN` | no          | auto    | MulmoClaude bearer token override |
| `MULMOCLAUDE_API_URL`    | no          | `http://localhost:3001` | MulmoClaude server URL |

## How it works

1. Twilio posts form-encoded `From`, `To`, `Body`, `MessageSid` to `/sms` every time an SMS arrives.
2. The bridge verifies `X-Twilio-Signature` (HMAC-SHA1 over URL + sorted params) using the auth token — if `TWILIO_PUBLIC_URL` is set.
3. We ACK `204` immediately so Twilio doesn't retry, then (asynchronously) forward the trimmed body to MulmoClaude keyed by the sender's number.
4. The reply is sent back via `POST /2010-04-01/Accounts/{SID}/Messages.json` with Basic auth; long replies are chunked at 1 600 chars (Twilio's concatenated-SMS ceiling).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| 401 at Twilio side | Signature verification failed | Verify `TWILIO_PUBLIC_URL` matches the URL Twilio actually hits (scheme + host + path, no trailing `/`) |
| No reply delivered | `Messages.json` REST call failing | `docker logs` / `npx` output will show `[twilio-sms] send failed: …`. Common cause: trial account can only message verified numbers |
| Duplicate replies | Twilio retried before ACK | Ensure reachable `https://` endpoint (not HTTP) and the bridge responds 2xx under 15 s |

## Security notes

- The auth token is equivalent to root credentials on your Twilio account. Rotate in the console if leaked.
- `TWILIO_PUBLIC_URL` is strongly recommended — without it, anyone who finds your webhook can impersonate Twilio and converse with your agent.
- Trial Twilio accounts can only SMS pre-verified numbers. Upgrade to production before real use.
- SMS is plaintext — don't discuss secrets over it. Use Signal / WhatsApp / Matrix instead for sensitive content.
