# @mulmobridge/line

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

LINE bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Uses webhook events — requires a public URL (ngrok for development).

## Setup

### 1. Create a LINE Messaging API Channel

1. Go to [LINE Developers Console](https://developers.line.biz/console/) → create a Provider → create a **Messaging API** channel
2. Note the **Channel secret** (Basic settings tab)
3. Issue a **Channel access token** (Messaging API tab → long-lived)

### 2. Set up ngrok (for development)

[ngrok](https://ngrok.com) is a tunneling tool that exposes a local port to the internet so LINE's webhooks can reach your machine.

```bash
brew install ngrok
ngrok config add-authtoken <your-token>  # from ngrok dashboard
ngrok http 3002
# Copy the https://xxxx.ngrok-free.app URL
```

### 3. Configure the webhook

In the LINE Developers Console → Messaging API tab:
- **Webhook URL**: `https://xxxx.ngrok-free.app/webhook` — the trailing `/webhook` is **required** (without it you get 404)
- **Use webhook**: enabled
- **Auto-reply messages**: disabled (LINE Official Account settings → Auto-reply messages → OFF, otherwise you get double replies)

### 4. Run the bridge

```bash
# With mock server (testing)
npx @mulmobridge/mock-server &
LINE_CHANNEL_SECRET=... \
LINE_CHANNEL_ACCESS_TOKEN=... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/line

# With real MulmoClaude
LINE_CHANNEL_SECRET=... \
LINE_CHANNEL_ACCESS_TOKEN=... \
npx @mulmobridge/line
```

### 5. Add the bot as a friend

Scan the QR code in the LINE Developers Console → Messaging API tab. Send a message — MulmoClaude replies.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `LINE_CHANNEL_SECRET` | Yes | Channel secret for signature verification |
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | Long-lived channel access token |
| `LINE_BRIDGE_PORT` | No | Webhook port (default: 3002) |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token |

## Notes

- LINE reply tokens expire in **1 minute**. Since Claude responses can take longer, the bridge uses **push messages** instead of reply messages. This requires your bot to be a verified/certified account for push to work with all users, OR the user must have added the bot as a friend first.
- LINE limits messages to 5 per push call and ~5000 chars per message. Long replies are automatically chunked.

## Detailed Setup Guide

For step-by-step instructions with troubleshooting:

- [English](https://github.com/receptron/mulmoclaude/blob/main/docs/message_apps/line/README.md)
- [Japanese](https://github.com/receptron/mulmoclaude/blob/main/docs/message_apps/line/README.ja.md)

## License

MIT
