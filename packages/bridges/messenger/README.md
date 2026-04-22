# @mulmobridge/messenger

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Facebook Messenger bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Uses the Meta Send/Receive API (webhook).

## Setup

### 1. Create a Meta App with Messenger

1. Go to [developers.facebook.com](https://developers.facebook.com/apps/) → **Create App** → **Business** type
2. Add the **Messenger** product
3. In Messenger Settings, connect a **Facebook Page** and generate a **Page Access Token**
4. Note the **App Secret** from Settings → Basic

### 2. Set up ngrok

```bash
ngrok http 3004
```

### 3. Configure webhook

In Meta Dashboard → Messenger → Settings → Webhooks:
- **Callback URL**: `https://xxxx.ngrok-free.app/webhook`
- **Verify token**: any string (set as `MESSENGER_VERIFY_TOKEN`)
- Subscribe to: `messages`

### 4. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
MESSENGER_PAGE_ACCESS_TOKEN=... \
MESSENGER_VERIFY_TOKEN=my-verify \
MESSENGER_APP_SECRET=... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/messenger

# With real MulmoClaude
MESSENGER_PAGE_ACCESS_TOKEN=... \
MESSENGER_VERIFY_TOKEN=my-verify \
MESSENGER_APP_SECRET=... \
npx @mulmobridge/messenger
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MESSENGER_PAGE_ACCESS_TOKEN` | Yes | Page access token |
| `MESSENGER_VERIFY_TOKEN` | Yes | Arbitrary string for webhook verification |
| `MESSENGER_APP_SECRET` | Yes | App secret for HMAC signature verification |
| `MESSENGER_BRIDGE_PORT` | No | Webhook port (default: 3004) |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token |

## License

MIT
