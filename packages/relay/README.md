# @mulmobridge/relay

Cloudflare Workers relay for MulmoBridge. Receives webhooks from messaging platforms (LINE, Telegram, etc.), queues messages when MulmoClaude is offline, and forwards them via WebSocket when connected.

## Why

Without the relay, webhook-based bridges (LINE, Slack, etc.) need a public URL — typically via ngrok, which requires manual URL updates on every restart.

With the relay:
- **Fixed URL** — `<your-name>.workers.dev` never changes
- **Offline queue** — messages are stored and delivered when MulmoClaude reconnects
- **Multi-platform** — one relay handles all platforms simultaneously
- **No ngrok** — deploy once, use forever

## Architecture

```text
LINE ─────→ /webhook/line ─────┐
Telegram ─→ /webhook/telegram ─┼→ Durable Object → WS → MulmoClaude
(future) ─→ /webhook/...  ────┘   (queue if offline)    (home PC)
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

```bash
# Relay authentication token (shared with MulmoClaude)
wrangler secret put RELAY_TOKEN

# LINE (if using)
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN

# Telegram (if using)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

### 3. Set webhook URLs in platform consoles

| Platform | Webhook URL |
|----------|-------------|
| LINE | `https://<name>.workers.dev/webhook/line` |
| Telegram | `https://<name>.workers.dev/webhook/telegram` |

For Telegram, set the webhook via Bot API:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<name>.workers.dev/webhook/telegram&secret_token=<SECRET>"
```

### 4. Connect MulmoClaude

Add to `.env`:
```dotenv
RELAY_URL=wss://<name>.workers.dev/ws
RELAY_TOKEN=<same token as step 2>
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check + configured platforms |
| GET | `/ws` | WebSocket (MulmoClaude connection, bearer auth) |
| POST | `/webhook/line` | LINE webhook (HMAC-SHA256 verified) |
| POST | `/webhook/telegram` | Telegram webhook (secret token verified) |

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
  mode: CONNECTION_MODES.webhook,  // or "polling" or "persistent"
  webhookPath: "/webhook/slack",
  isConfigured: (env) => !!env.SLACK_SIGNING_SECRET,
  handleWebhook: async (request, body, env) => { /* ... */ },
  sendResponse: async (chatId, text, env) => { /* ... */ },
};
registerPlatform(slackPlugin);
```

Three connection modes are supported:

| Mode | Examples | Method |
|------|----------|--------|
| `webhook` | LINE, Messenger, Google Chat | Platform POSTs to relay URL |
| `polling` | Telegram (alt) | Relay fetches from platform API |
| `persistent` | Slack Socket Mode, Discord Gateway | Relay maintains WS to platform |

### Relay vs Bridge packages

| | Relay | Bridge (`@mulmobridge/*`) |
|---|---|---|
| Runs on | Cloud (CF Workers) | User's computer |
| Public URL | Permanent | Requires ngrok |
| Offline queue | Yes | No |
| Multi-platform | One relay | One process each |

Both can coexist. Some platforms via Relay, others via local Bridge.

## License

AGPL-3.0-only
