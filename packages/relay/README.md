# @mulmobridge/relay

Cloudflare Workers relay for MulmoBridge. Receives webhooks from messaging platforms (LINE, WhatsApp, Messenger, Google Chat, Telegram, Microsoft Teams), queues messages when MulmoClaude is offline, and forwards them via WebSocket when connected.

## Why

Without the relay, webhook-based bridges (LINE, Slack, etc.) need a public URL — typically via ngrok, which requires manual URL updates on every restart.

With the relay:

- **Fixed URL** — `<your-name>.workers.dev` never changes
- **Offline queue** — messages are stored and delivered when MulmoClaude reconnects
- **Multi-platform** — one relay handles all platforms simultaneously
- **No ngrok** — deploy once, use forever

## Architecture

```text
LINE ─────────→ /webhook/line         ┐
WhatsApp ─────→ /webhook/whatsapp     │
Messenger ────→ /webhook/messenger    │
Google Chat ──→ /webhook/google-chat  ├→ Durable Object → WS → MulmoClaude
Telegram ─────→ /webhook/telegram     │   (queue if offline)    (home PC)
Teams ────────→ /webhook/teams        ┘
```

## Setup

### 1. Deploy the relay

```bash
# Install wrangler (Cloudflare CLI)
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Clone and deploy
cd packages/relay
wrangler deploy
```

### 2. Configure secrets

Only register secrets for platforms you actually use — the relay's `/health` endpoint reports `configured: true/false` per platform based on whether its secrets are present.

```bash
# Relay authentication token (shared with MulmoClaude) — always required
wrangler secret put RELAY_TOKEN
```

#### LINE

```bash
wrangler secret put LINE_CHANNEL_SECRET        # "Channel secret" in LINE console
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN  # "Channel access token (long-lived)"
```

#### WhatsApp (Meta Cloud API)

```bash
wrangler secret put WHATSAPP_APP_SECRET        # Meta app → Settings → Basic → App Secret
wrangler secret put WHATSAPP_VERIFY_TOKEN      # arbitrary string, repeated in the console verification step
wrangler secret put WHATSAPP_ACCESS_TOKEN      # WhatsApp → API Setup → Access Token
wrangler secret put WHATSAPP_PHONE_NUMBER_ID   # WhatsApp → API Setup → From (Phone Number ID)
```

#### Messenger

```bash
wrangler secret put MESSENGER_APP_SECRET        # Meta app → Settings → Basic → App Secret
wrangler secret put MESSENGER_VERIFY_TOKEN      # arbitrary string, repeated in the console verification step
wrangler secret put MESSENGER_PAGE_ACCESS_TOKEN # Meta app → Messenger → Settings → Page token
```

#### Google Chat

```bash
wrangler secret put GOOGLE_CHAT_PROJECT_NUMBER       # GCP project number (verifies inbound JWT audience)
wrangler secret put GOOGLE_CHAT_SERVICE_ACCOUNT_KEY  # Service-account JSON — paste the full JSON at the prompt
```

#### Telegram

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

#### Microsoft Teams

```bash
wrangler secret put MICROSOFT_APP_ID                # Azure Bot → Configuration → Microsoft App ID
wrangler secret put MICROSOFT_APP_PASSWORD          # Client secret generated for that app
# Only for SingleTenant apps:
wrangler secret put MICROSOFT_APP_TENANT_ID
# Optional: AAD user object ID allowlist (CSV)
wrangler secret put TEAMS_ALLOWED_USERS
```

Also set `MICROSOFT_APP_TYPE` under `[vars]` in `wrangler.toml` (values: `MultiTenant` — default — or `SingleTenant`). It's non-sensitive, so it belongs in vars, not secrets.

### 3. Set webhook URLs in platform consoles

| Platform    | Webhook URL                                      | Where to register                                                                                                                                 |
| ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| LINE        | `https://<name>.workers.dev/webhook/line`        | [LINE Developers Console](https://developers.line.biz/console/) → channel → **Messaging API** → **Webhook URL**                                   |
| WhatsApp    | `https://<name>.workers.dev/webhook/whatsapp`    | [Meta for Developers](https://developers.facebook.com/apps/) → WhatsApp → **Configuration** → **Webhook** (use `WHATSAPP_VERIFY_TOKEN` at prompt) |
| Messenger   | `https://<name>.workers.dev/webhook/messenger`   | [Meta for Developers](https://developers.facebook.com/apps/) → Messenger → **Settings** → **Webhooks** (use `MESSENGER_VERIFY_TOKEN` at prompt)   |
| Google Chat | `https://<name>.workers.dev/webhook/google-chat` | [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Google Chat API → **Configuration** → **App URL**                   |
| Telegram    | `https://<name>.workers.dev/webhook/telegram`    | Set via Bot API call (see below)                                                                                                                  |
| Teams       | `https://<name>.workers.dev/webhook/teams`       | [Azure Portal](https://portal.azure.com/) → Azure Bot resource → **Configuration** → **Messaging endpoint**                                       |

Telegram is the odd one out — no GUI, set via API:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<name>.workers.dev/webhook/telegram&secret_token=<SECRET>"
```

**Meta-family verify token note**: Both WhatsApp and Messenger use the Graph webhook verification handshake. When you paste the webhook URL in the Meta console, it prompts for a "Verify Token" — enter the same string you stored in `WHATSAPP_VERIFY_TOKEN` / `MESSENGER_VERIFY_TOKEN` respectively. The relay's GET handler returns the `hub.challenge` echo only when the token matches.

### 4. Connect MulmoClaude

Add to `.env`:

```dotenv
RELAY_URL=wss://<name>.workers.dev/ws
RELAY_TOKEN=<same token as step 2>
```

## Endpoints

| Method | Path                   | Description                                                                                                                    |
| ------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`              | Health check + configured platforms                                                                                            |
| GET    | `/ws`                  | WebSocket (MulmoClaude connection, bearer auth)                                                                                |
| POST   | `/webhook/line`        | LINE webhook (HMAC-SHA256 verified)                                                                                            |
| POST   | `/webhook/whatsapp`    | WhatsApp Cloud API webhook (Meta signature + `hub.verify_token` echo for GET)                                                  |
| POST   | `/webhook/messenger`   | Messenger webhook (Meta signature + `hub.verify_token` echo for GET)                                                           |
| POST   | `/webhook/google-chat` | Google Chat webhook (JWT `iss=chat@system.gserviceaccount.com`, audience = `GOOGLE_CHAT_PROJECT_NUMBER`)                       |
| POST   | `/webhook/telegram`    | Telegram webhook (secret token verified)                                                                                       |
| POST   | `/webhook/teams`       | Microsoft Teams webhook (Azure AD JWT verified, aud = `MICROSOFT_APP_ID`; non-message activities acked 200 without forwarding) |

## Security

- **Webhook verification**: Each platform's signature is verified before processing
- **WebSocket auth**: Bearer token required for MulmoClaude connection
- **TLS**: All connections are HTTPS/WSS (Cloudflare provides certificates)
- **1-connection limit**: Only one MulmoClaude can connect at a time
- **Body size limit**: 1MB max per webhook request
- **Queue limit**: 1000 messages max (oldest dropped when exceeded)

## Adding a new platform (developer notes)

The relay uses a plugin architecture. Each platform is a self-contained
file in `src/webhooks/` that implements `PlatformPlugin`:

```typescript
// src/webhooks/slack.ts
const slackPlugin: PlatformPlugin = {
  name: PLATFORMS.slack,
  mode: CONNECTION_MODES.webhook, // or "polling" or "persistent"
  webhookPath: "/webhook/slack",
  isConfigured: (env) => !!env.SLACK_SIGNING_SECRET,
  handleWebhook: async (request, body, env) => {
    /* ... */
  },
  sendResponse: async (chatId, text, env) => {
    /* ... */
  },
};
registerPlatform(slackPlugin);
```

Three connection modes are supported:

| Mode         | Examples                           | Method                          |
| ------------ | ---------------------------------- | ------------------------------- |
| `webhook`    | LINE, Messenger, Google Chat       | Platform POSTs to relay URL     |
| `polling`    | Telegram (alt)                     | Relay fetches from platform API |
| `persistent` | Slack Socket Mode, Discord Gateway | Relay maintains WS to platform  |

### Relay vs Bridge packages

|                | Relay              | Bridge (`@mulmobridge/*`) |
| -------------- | ------------------ | ------------------------- |
| Runs on        | Cloud (CF Workers) | User's computer           |
| Public URL     | Permanent          | Requires ngrok            |
| Offline queue  | Yes                | No                        |
| Multi-platform | One relay          | One process each          |

Both can coexist. Some platforms via Relay, others via local Bridge.

## License

MIT
