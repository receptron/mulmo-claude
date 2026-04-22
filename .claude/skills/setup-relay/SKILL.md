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
4. **workers.dev subdomain**: If this is the user's first time using Workers, they need a `workers.dev` subdomain. Tell them to open the Cloudflare dashboard → **Compute** → **Workers & Pages**. Opening this page for the first time automatically creates the subdomain.

## Step 2: Deploy the Relay

Tell the user to run:

```
! cd packages/relay && wrangler deploy
```

Wait for the user to confirm. Ask them to paste the output URL (e.g., `https://mulmobridge-relay.xxx.workers.dev`).

Save the URL — you'll need it for Step 4.

## Step 3: Set secrets

### RELAY_TOKEN

Tell the user to run the following in their terminal (token generation + secret registration). The user should keep the generated token — it will also be needed for `.env` in Step 4.

```bash
# Generate token, save to clipboard/notepad, then register as secret
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
cd packages/relay && wrangler secret put RELAY_TOKEN
```

### Platform secrets

Ask the user **which platforms** they want to set up. Supported webhook platforms: **LINE, WhatsApp, Messenger, Google Chat, Telegram, Microsoft Teams**. Only register secrets and webhook URLs for the ones they pick — `/health` reports `configured: true/false` per platform, so unused ones stay dormant with zero cost.

For each selected platform, walk through the matching block below. All `wrangler secret put` invocations must run from `packages/relay`, use the `!` prefix (the user types the secret in their own terminal), and each registers exactly one secret.

#### LINE

1. [LINE Developers Console](https://developers.line.biz/console/) → channel → **Messaging API** tab → copy **Channel secret** and **Channel access token (long-lived)**.
2. Register:
   ```
   ! cd packages/relay && wrangler secret put LINE_CHANNEL_SECRET
   ! cd packages/relay && wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
   ```
3. In the same console screen, set **Webhook URL** to:
   ```
   https://<relay-url>/webhook/line
   ```
4. Toggle **Use webhook** ON and verify with the console's "Verify" button.

#### WhatsApp (Meta Cloud API)

1. [Meta for Developers](https://developers.facebook.com/apps/) → your app → **Settings** → **Basic** → copy **App Secret**.
2. In the same app → **WhatsApp** → **API Setup** → copy **Access Token** and **Phone Number ID** (the "From" field). Keep a browser tab open — you'll come back for webhook registration.
3. Pick any string to use as your own verify token (e.g. `openssl rand -hex 16`). The user will paste this same string into Meta's console in a moment.
4. Register the four secrets:
   ```
   ! cd packages/relay && wrangler secret put WHATSAPP_APP_SECRET
   ! cd packages/relay && wrangler secret put WHATSAPP_VERIFY_TOKEN
   ! cd packages/relay && wrangler secret put WHATSAPP_ACCESS_TOKEN
   ! cd packages/relay && wrangler secret put WHATSAPP_PHONE_NUMBER_ID
   ```
5. Back in Meta console → WhatsApp → **Configuration** → **Webhook** → **Edit** → enter:
   - Callback URL: `https://<relay-url>/webhook/whatsapp`
   - Verify Token: the same string used for `WHATSAPP_VERIFY_TOKEN` above
   - Click **Verify and save** — Meta will hit the relay's GET handler and expect the verify-token echo.
6. Under **Webhook fields**, subscribe to at least `messages`.

#### Messenger

1. [Meta for Developers](https://developers.facebook.com/apps/) → your app → **Settings** → **Basic** → copy **App Secret** (can share with WhatsApp if same app).
2. Add **Messenger** product (if not already) → **Settings** → **Access Tokens** → generate a **Page Access Token** for the Facebook Page you want to bridge.
3. Pick a verify-token string (same pattern as WhatsApp above).
4. Register the three secrets:
   ```
   ! cd packages/relay && wrangler secret put MESSENGER_APP_SECRET
   ! cd packages/relay && wrangler secret put MESSENGER_VERIFY_TOKEN
   ! cd packages/relay && wrangler secret put MESSENGER_PAGE_ACCESS_TOKEN
   ```
5. In Messenger settings → **Webhooks** → **Add Callback URL** → enter:
   - Callback URL: `https://<relay-url>/webhook/messenger`
   - Verify Token: same string used for `MESSENGER_VERIFY_TOKEN` above
6. Subscribe the callback to the target Page under **Webhooks** → **Add or Remove Pages**. Required fields: `messages`, `messaging_postbacks` (at minimum).

#### Google Chat

1. [Google Cloud Console](https://console.cloud.google.com/) → pick/create a project → **APIs & Services** → enable **Google Chat API**.
2. **IAM & Admin** → **Service Accounts** → create a service account (or reuse) → **Keys** → **Add Key** → **Create new key** → JSON → downloads a file. **Keep the full JSON handy**.
3. Copy the **project number** (not project ID) from the console's home / Dashboard. The relay uses it as the audience claim when verifying Google's inbound JWT.
4. Register:
   ```
   ! cd packages/relay && wrangler secret put GOOGLE_CHAT_PROJECT_NUMBER
   ! cd packages/relay && wrangler secret put GOOGLE_CHAT_SERVICE_ACCOUNT_KEY
   ```
   For `GOOGLE_CHAT_SERVICE_ACCOUNT_KEY`, paste the **entire JSON contents** at the prompt (wrangler accepts multi-line).
5. In the Cloud Console → **APIs & Services** → **Google Chat API** → **Configuration** → fill:
   - App URL: `https://<relay-url>/webhook/google-chat`
   - Connection settings: **App URL** (HTTP)
   - Functionality: match what you want (1:1 DMs, spaces, etc.)

#### Telegram

1. Create a bot via [@BotFather](https://t.me/BotFather) — `/newbot` — copy the token.
2. Pick a webhook secret (`openssl rand -hex 16`).
3. Register:
   ```
   ! cd packages/relay && wrangler secret put TELEGRAM_BOT_TOKEN
   ! cd packages/relay && wrangler secret put TELEGRAM_WEBHOOK_SECRET
   ```
4. Register the webhook via API (no GUI):
   ```bash
   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<relay-url>/webhook/telegram&secret_token=<SECRET>"
   ```

#### Microsoft Teams

1. [Azure Portal](https://portal.azure.com/) → create **Azure Bot** resource (pricing tier F0 for free) → choose **Multi-tenant** (the simplest option) or **Single-tenant** if the bot is company-only.
2. After creation, open the bot resource → **Configuration** → copy **Microsoft App ID**. Click **Manage** next to it → **Certificates & secrets** → **New client secret** → copy the **Value** (shows only once).
3. (SingleTenant only) copy the **Tenant ID** from the same AAD app registration page.
4. Register secrets:
   ```
   ! cd packages/relay && wrangler secret put MICROSOFT_APP_ID
   ! cd packages/relay && wrangler secret put MICROSOFT_APP_PASSWORD
   ```
   For SingleTenant, also:
   ```
   ! cd packages/relay && wrangler secret put MICROSOFT_APP_TENANT_ID
   ```
   (Optional) AAD user object-ID allowlist:
   ```
   ! cd packages/relay && wrangler secret put TEAMS_ALLOWED_USERS
   ```
5. Edit `packages/relay/wrangler.toml` and add `MICROSOFT_APP_TYPE` under `[vars]` (non-secret) — values: `MultiTenant` (default) or `SingleTenant`. Re-run `wrangler deploy` after editing.
6. Back in the Azure Bot resource → **Configuration** → **Messaging endpoint**:
   ```
   https://<relay-url>/webhook/teams
   ```
   Click **Apply** — Azure doesn't do a verify-token handshake, but your bot won't receive messages until the endpoint is saved here.
7. Teams channel — on the same bot resource go to **Channels** → **Microsoft Teams** → accept T&C → **Apply**.
8. Create a Teams app manifest (simplest path: [Developer Portal](https://dev.teams.microsoft.com/) → **Apps** → **New app** → set the `botId` to `MICROSOFT_APP_ID`) and install it into a team / personal scope.

## Step 4: Configure MulmoClaude

Tell the user to add the Relay connection to `.env` themselves. Both the URL (from Step 2) and the token (generated in Step 3) are needed:

```bash
echo "" >> .env
echo "# MulmoBridge Relay" >> .env
echo "RELAY_URL=wss://<relay-url>/ws" >> .env
echo "RELAY_TOKEN=<token-from-step-3>" >> .env
```

**Important**: The token value was generated by the user in Step 3. Do NOT generate a new token — ask the user to use the same value they registered with `wrangler secret put`.

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

- `wrangler secret put` is interactive — the user must run it themselves (use `!` prefix), and must be run from `packages/relay` directory
- `wrangler deploy` and `wrangler login` require browser interaction
- **workers.dev subdomain**: First-time Workers users must open the Workers & Pages dashboard to auto-create their subdomain before `wrangler deploy` will succeed
- The RELAY_TOKEN must be identical in both the Cloudflare secret and the `.env` file
- **Token management**: Let the user generate and manage the token in their own terminal. Do NOT generate it in Claude's shell — this avoids the user having to copy a value back from the conversation
- LINE webhook URL must be the Relay URL, not the old ngrok URL
- **Meta verify tokens (WhatsApp / Messenger)**: the same string must be in `wrangler secret` AND the Meta console "Verify Token" field — Meta's "Verify and save" button calls the relay's GET handler expecting that exact echo, and silently fails on mismatch with no obvious error
- **Google Chat uses the project number, not project ID** — project number is numeric (found on the Cloud Console home page), project ID is the human-readable slug
- **Google Chat service-account JSON**: paste the _entire_ JSON blob (multi-line) at the wrangler prompt — do not base64-encode or try to escape it
- Messenger webhooks require per-page subscription in addition to the app-level callback — setting only the callback URL is not enough; messages will arrive at Meta but never get forwarded to the app
- **Teams SingleTenant**: must set both `MICROSOFT_APP_TENANT_ID` (secret) and `MICROSOFT_APP_TYPE=SingleTenant` (var in `wrangler.toml`) — missing either and `/health` reports `teams: false`
- **Teams client secret shown once**: Azure's "New client secret" dialog displays the Value only on creation — if the user misses it, they have to generate a new one
- **Teams endpoint is persistent once saved**: Azure doesn't verify the endpoint actively; you won't know it's wrong until a real message fails to arrive. Test with a personal-scope DM first
- Durable Objects work on the free plan when using `new_sqlite_classes` in `wrangler.toml` (the default in this project)
