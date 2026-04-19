# @mulmobridge/slack

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new). Your feedback helps us improve.

Slack bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Uses **Socket Mode** — no public URL or ngrok needed.

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it (e.g. "MulmoClaude") and pick your workspace

### 2. Configure permissions

**OAuth & Permissions** → add these Bot Token Scopes:
- `chat:write` — send messages
- `channels:history` — read messages in public channels
- `groups:history` — read messages in private channels
- `im:history` — read direct messages
- `mpim:history` — read group DMs

### 3. Enable Socket Mode

**Socket Mode** → toggle **Enable Socket Mode** → create an App-Level Token with `connections:write` scope. Copy the `xapp-...` token.

### 4. Enable Events

**Event Subscriptions** → toggle **Enable Events** → subscribe to:
- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`

### 5. Install to workspace

**Install App** → **Install to Workspace** → copy the `xoxb-...` Bot User OAuth Token.

### 6. Run the bridge

```bash
# With mock server (for testing)
npx @mulmobridge/mock-server &
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/slack

# With real MulmoClaude
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
npx @mulmobridge/slack
```

### 7. Invite the bot

In Slack, invite the bot to a channel: `/invite @MulmoClaude`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | `xoxb-...` Bot User OAuth Token |
| `SLACK_APP_TOKEN` | Yes | `xapp-...` App-Level Token (connections:write) |
| `SLACK_ALLOWED_CHANNELS` | No | CSV of channel IDs to restrict access (empty = all) |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token (auto-read from workspace if not set) |

## License

MIT
