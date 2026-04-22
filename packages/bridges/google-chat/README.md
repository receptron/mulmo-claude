# @mulmobridge/google-chat

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Google Chat bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Uses HTTP endpoint mode (synchronous responses).

## Setup

### 1. Create a Google Chat App

1. Go to [Google Cloud Console](https://console.cloud.google.com/) → create or select a project
2. Enable the **Google Chat API**
3. Go to **APIs & Services → Credentials** and note your **Project Number**
4. Configure the Chat app:
   - **App name**: MulmoClaude
   - **App URL**: your public endpoint (ngrok for dev)
   - **Functionality**: receive 1:1 messages and join spaces

### 2. Set up ngrok

```bash
ngrok http 3005
```

### 3. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
GOOGLE_CHAT_PROJECT_NUMBER=123456 \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/google-chat

# With real MulmoClaude
GOOGLE_CHAT_PROJECT_NUMBER=123456 \
npx @mulmobridge/google-chat
```

### 4. Message the bot

In Google Chat, find your app and send it a direct message.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CHAT_PROJECT_NUMBER` | Yes | Google Cloud project number |
| `GOOGLE_CHAT_BRIDGE_PORT` | No | Webhook port (default: 3005) |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token |

## Security — Request Verification

Every incoming webhook request is verified using Google's OIDC JWT mechanism:

1. The `Authorization: Bearer <token>` header is extracted
2. The JWT signature is verified against Google's JWKS endpoint (`https://www.googleapis.com/service_accounts/v1/jwk/chat@system.gserviceaccount.com`)
3. The following claims are checked:
   - `iss` must be `chat@system.gserviceaccount.com`
   - `aud` must match `GOOGLE_CHAT_PROJECT_NUMBER`
   - `exp` must not be in the past
4. Requests that fail verification receive `401 Unauthorized`

This prevents spoofed requests from arbitrary third parties.

## Limitations

- **Synchronous mode only**: Google Chat expects a response within 30 seconds. Agent responses that take longer will time out. For async responses, a service account with the Chat API is needed (future enhancement).
- **No push delivery**: server→bridge push requires the async Chat API with a service account. Currently pushes are logged but not delivered.

## License

MIT
