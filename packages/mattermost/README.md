# @mulmobridge/mattermost

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Mattermost bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Uses the WebSocket API — no public URL needed.

## Setup

### 1. Create a Bot Account

1. Go to **Integrations → Bot Accounts → Add Bot Account** (requires admin)
2. Set a username (e.g. `mulmo-bot`) and display name
3. Copy the **Access Token**

### 2. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
MATTERMOST_URL=https://mattermost.example.com \
MATTERMOST_BOT_TOKEN=... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/mattermost

# With real MulmoClaude
MATTERMOST_URL=https://mattermost.example.com \
MATTERMOST_BOT_TOKEN=... \
npx @mulmobridge/mattermost
```

### 3. Add the bot to a channel

In Mattermost, add the bot to channels where you want it to respond.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MATTERMOST_URL` | Yes | Server URL (e.g. `https://mm.example.com`) |
| `MATTERMOST_BOT_TOKEN` | Yes | Bot account access token |
| `MATTERMOST_ALLOWED_CHANNELS` | No | CSV of channel IDs (empty = all) |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token |

## License

MIT
