# @mulmobridge/whatsapp

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

WhatsApp bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude) via Meta's Cloud API. Requires a Meta Business account.

## Setup

### 1. Create a Meta App

1. Go to [developers.facebook.com](https://developers.facebook.com/apps/) → **Create App** → **Business** type
2. Add the **WhatsApp** product
3. In WhatsApp → Getting Started, note your **Phone Number ID** and generate a **permanent access token**

### 2. Set up ngrok

```bash
ngrok http 3003
```

### 3. Configure webhook

In Meta Dashboard → WhatsApp → Configuration:
- **Callback URL**: `https://xxxx.ngrok-free.app/webhook`
- **Verify token**: any string you choose (set as `WHATSAPP_VERIFY_TOKEN`)
- Subscribe to: `messages`

### 4. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
WHATSAPP_ACCESS_TOKEN=... \
WHATSAPP_PHONE_NUMBER_ID=... \
WHATSAPP_VERIFY_TOKEN=my-verify-token \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/whatsapp

# With real MulmoClaude
WHATSAPP_ACCESS_TOKEN=... \
WHATSAPP_PHONE_NUMBER_ID=... \
WHATSAPP_VERIFY_TOKEN=my-verify-token \
npx @mulmobridge/whatsapp
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | Yes | Permanent access token from Meta dashboard |
| `WHATSAPP_PHONE_NUMBER_ID` | Yes | Phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Yes | Arbitrary string for webhook verification |
| `WHATSAPP_BRIDGE_PORT` | No | Webhook port (default: 3003) |
| `WHATSAPP_ALLOWED_NUMBERS` | No | CSV of phone numbers (empty = all) |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token |

## Notes

- WhatsApp has a **24-hour messaging window**: you can only reply to a user within 24 hours of their last message. After that, you need a pre-approved template message to initiate contact.
- The Meta Cloud API requires a **verified Business account** for production use. The test number works for development.

## License

MIT
