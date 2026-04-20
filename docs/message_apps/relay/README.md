# MulmoBridge Relay — No more ngrok

Japanese: [`README.ja.md`](README.ja.md)

---

## What is the Relay?

When you use LINE, Slack, or Messenger with MulmoClaude, those
services need to send messages to your computer. Normally that
requires **ngrok** — a tool that creates a temporary public URL
pointing to your machine. The problem? Every time you restart
ngrok, the URL changes and you have to update it in the LINE
console.

The **Relay** solves this. It's a tiny server that runs in the
cloud (Cloudflare Workers) with a **permanent URL**. LINE sends
messages to the Relay, and the Relay forwards them to your
computer over a secure WebSocket connection. When your computer
is off, messages are queued and delivered when you come back
online.

```text
Your phone (LINE/Telegram)
     ↓ message
Relay (cloud, permanent URL)
     ↓ WebSocket (encrypted)
Your computer (MulmoClaude)
     ↓
Claude responds
     ↓
Relay → LINE/Telegram → Your phone
```

### Before vs After

| | Before (ngrok) | After (Relay) |
|---|---|---|
| Public URL | Changes every restart | Permanent |
| Setup per restart | Copy URL → LINE console | Nothing |
| Computer off | Messages lost | Messages queued |
| ngrok needed | Yes | No |
| Multiple platforms | Separate process each | One Relay handles all |

---

## What you need

1. **A Cloudflare account** (free) — [sign up here](https://dash.cloudflare.com/sign-up)
2. **Node.js 20+** installed on your computer
3. **MulmoClaude** already running (`yarn dev`)
4. **A messaging bot** already created (LINE bot, Telegram bot, etc.)

> **Cost**: Cloudflare Workers free tier includes 100,000 requests
> per day — more than enough for personal use. The Relay uses
> Durable Objects which require the Workers Paid plan ($5/month)
> for production, but you can test with the free tier.

---

## Step-by-step setup

### Step 1: Install the Cloudflare CLI

```bash
npm install -g wrangler
```

### Step 2: Log in to Cloudflare

```bash
wrangler login
```

A browser window opens. Log in to your Cloudflare account and
authorize Wrangler.

### Step 3: Deploy the Relay

```bash
cd packages/relay
wrangler deploy
```

You'll see output like:

```
Published mulmobridge-relay
  https://mulmobridge-relay.YOUR-NAME.workers.dev
```

**Save this URL** — this is your permanent Relay address.

### Step 4: Set the authentication token

This token is shared between the Relay and MulmoClaude so only
your computer can connect.

```bash
wrangler secret put RELAY_TOKEN
```

Type a strong random password when prompted. **Remember it** —
you'll need it in Step 6.

### Step 5: Configure your messaging platform

#### For LINE

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

Enter the values from your LINE Developers Console.

Then update your LINE webhook URL to:

```
https://mulmobridge-relay.YOUR-NAME.workers.dev/webhook/line
```

#### For Telegram

```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Then set the webhook via Telegram's Bot API:

```bash
curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://mulmobridge-relay.YOUR-NAME.workers.dev/webhook/telegram&secret_token=<YOUR_WEBHOOK_SECRET>"
```

### Step 6: Connect MulmoClaude to the Relay

Add to your MulmoClaude `.env` file:

```dotenv
RELAY_URL=wss://mulmobridge-relay.YOUR-NAME.workers.dev/ws
RELAY_TOKEN=the-same-token-from-step-4
```

Then start MulmoClaude:

```bash
yarn dev
```

### Step 7: Test it!

Send a message from your LINE or Telegram app. You should see
the message appear in MulmoClaude's server log, and Claude's
response should appear in your chat app.

---

## Using multiple platforms at once

The Relay can handle LINE and Telegram simultaneously. Just
configure both sets of secrets (Step 5) and both webhook URLs.
Messages from all platforms arrive through a single WebSocket
connection.

Check which platforms are configured:

```bash
curl https://mulmobridge-relay.YOUR-NAME.workers.dev/health
```

Response:

```json
{ "status": "ok", "platforms": { "line": true, "telegram": true } }
```

---

## When your computer is off

Messages are stored in the Relay (up to 1,000 messages). When
your computer reconnects, all queued messages are delivered
automatically. You don't need to do anything.

---

## Security

| Layer | Protection |
|---|---|
| Phone → Relay | LINE: HMAC-SHA256 signature verification. Telegram: secret token header |
| Relay → Computer | Encrypted WebSocket (wss://) + bearer token |
| Cloudflare | DDoS protection, TLS certificates (automatic) |
| Access control | Only your computer can connect (1 connection limit) |

Your messages pass through Cloudflare's network. They are
encrypted in transit (TLS) and temporarily stored in the
Durable Object when your computer is offline. Stored messages
are deleted after delivery. No long-term storage.

---

## Troubleshooting

### "LINE not configured" (404)

You haven't set the LINE secrets yet. Run:

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```

### Messages not arriving

1. Check the health endpoint — is your platform listed as `true`?
2. Check MulmoClaude server logs — do you see relay connection messages?
3. Verify your `.env` has the correct `RELAY_URL` and `RELAY_TOKEN`

### "Unauthorized" (401) on webhook

The webhook signature verification failed. Double-check that
`LINE_CHANNEL_SECRET` (or `TELEGRAM_WEBHOOK_SECRET`) matches
what's in your platform's developer console.

### Computer reconnects but no queued messages

The queue holds up to 1,000 messages. If more than 1,000
messages arrived while offline, the oldest ones are dropped.

---

## Updating the Relay

When a new version is released:

```bash
cd packages/relay
git pull origin main
wrangler deploy
```

Your secrets are preserved — no need to re-enter them.

---

## Guided setup with Claude Code

If you're using Claude Code inside MulmoClaude, you can run the
setup interactively:

```
/setup-relay
```

Claude will walk you through each step — checking prerequisites,
deploying the Relay, configuring secrets, and connecting MulmoClaude.
Commands that require browser interaction (like `wrangler login`)
are run in your terminal via the `!` prefix.
