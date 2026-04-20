---
description: Interactively guide MulmoBridge Relay setup — Cloudflare Workers deploy, platform secrets, and MulmoClaude connection. Respond in the user's language.
---

# Setup MulmoBridge Relay

Guide the user through Relay setup following `docs/message_apps/relay/`. Use the language-appropriate version (README.md for English, README.ja.md for Japanese) based on the user's language.

## Step 1: Prerequisites

1. Check MulmoClaude is running (`lsof -i :3001 -sTCP:LISTEN`). If not, ask the user to run `yarn dev` first.
2. Check wrangler is installed (`which wrangler`). If not:
   ```bash
   npm install -g wrangler
   ```
3. Check wrangler is authenticated (`wrangler whoami`). If not, tell the user to run:
   ```
   ! wrangler login
   ```
   (The `!` prefix runs it in the user's terminal since it requires browser interaction.)

## Step 2: Deploy the Relay

Tell the user to run:
```
! cd packages/relay && wrangler deploy
```

Wait for the user to confirm. Ask them to paste the output URL (e.g., `https://mulmobridge-relay.xxx.workers.dev`).

Save the URL — you'll need it for Step 4.

## Step 3: Set secrets

### RELAY_TOKEN

Generate a random token:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Tell the user to run:
```
! wrangler secret put RELAY_TOKEN
```
And paste the generated token. **Save this token** for Step 4.

### Platform secrets

Ask the user which platforms they want to use. For each selected platform:

#### LINE
Tell the user to run:
```
! wrangler secret put LINE_CHANNEL_SECRET
! wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
```
And enter their LINE Developers Console values.

Then tell them to update their LINE webhook URL to:
```
https://<relay-url>/webhook/line
```

#### Telegram
Tell the user to run:
```
! wrangler secret put TELEGRAM_BOT_TOKEN
! wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

Then set the webhook:
```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<relay-url>/webhook/telegram&secret_token=<SECRET>"
```

## Step 4: Configure MulmoClaude

Add the Relay connection to `.env`:

```bash
echo "" >> .env
echo "# MulmoBridge Relay" >> .env
echo "RELAY_URL=wss://<relay-url>/ws" >> .env
echo "RELAY_TOKEN=<token-from-step-3>" >> .env
```

Replace `<relay-url>` with the URL from Step 2, and `<token-from-step-3>` with the token generated in Step 3.

## Step 5: Verify

1. Check the health endpoint:
   ```bash
   curl https://<relay-url>/health
   ```
   Confirm the configured platforms show `true`.

2. Restart MulmoClaude:
   ```bash
   # Tell user to restart yarn dev
   ```

3. Send a test message from the configured platform.

4. Check server logs for relay connection and message delivery.

## Key pitfalls to highlight

- `wrangler secret put` is interactive — the user must run it themselves (use `!` prefix)
- `wrangler deploy` and `wrangler login` require browser interaction
- The RELAY_TOKEN must be identical in both the Cloudflare secret and the `.env` file
- LINE webhook URL must be the Relay URL, not the old ngrok URL
- If using Durable Objects, the user needs Workers Paid plan ($5/month) — the free tier works for testing but has limitations
