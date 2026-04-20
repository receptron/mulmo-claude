# @mulmobridge/discord

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Discord bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). The bot responds to messages in channels it has access to.

## Setup

### 1. Create a Discord Application

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application**
2. Name it (e.g. "MulmoClaude")

### 2. Create the Bot

1. **Bot** tab → **Add Bot**
2. Copy the **Token** (this is your `DISCORD_BOT_TOKEN`)
3. Enable **Message Content Intent** under Privileged Gateway Intents

### 3. Invite the bot to your server

**OAuth2** → **URL Generator**:
- Scopes: `bot`
- Permissions: `Send Messages`, `Read Message History`

Copy the generated URL and open it in your browser to invite the bot.

### 4. Run the bridge

```bash
# With mock server (testing)
npx @mulmobridge/mock-server &
DISCORD_BOT_TOKEN=... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/discord

# With real MulmoClaude
DISCORD_BOT_TOKEN=... \
npx @mulmobridge/discord
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_BOT_TOKEN` | Yes | Bot token from Developer Portal |
| `DISCORD_ALLOWED_CHANNELS` | No | CSV of channel IDs to restrict (empty = all) |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token (auto-read from workspace) |

## License

MIT
