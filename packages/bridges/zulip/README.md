# @mulmobridge/zulip

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Zulip bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Uses the events long-polling API — no public URL needed.

## Setup

### 1. Create a Bot

1. Go to **Settings → Your bots → Add a new bot**
2. Choose **Generic bot** type
3. Copy the **API key** and **email**

### 2. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
ZULIP_URL=https://your-org.zulipchat.com \
ZULIP_EMAIL=mulmo-bot@your-org.zulipchat.com \
ZULIP_API_KEY=... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/zulip

# With real MulmoClaude
ZULIP_URL=https://your-org.zulipchat.com \
ZULIP_EMAIL=mulmo-bot@your-org.zulipchat.com \
ZULIP_API_KEY=... \
npx @mulmobridge/zulip
```

The bot responds to all messages in streams it's subscribed to and all private messages.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ZULIP_URL` | Yes | Server URL |
| `ZULIP_EMAIL` | Yes | Bot email address |
| `ZULIP_API_KEY` | Yes | Bot API key |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token |

## License

MIT
