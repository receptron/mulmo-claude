# @mulmobridge/telegram

Telegram bot bridge for MulmoBridge. Connect a Telegram bot to MulmoClaude.

## Usage

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Start the MulmoClaude server (`yarn dev` in the main repo)
3. Run the Telegram bridge:

```bash
# npx (no install needed)
TELEGRAM_BOT_TOKEN=your-token TELEGRAM_ALLOWED_CHAT_IDS=123,456 \
  npx @mulmobridge/telegram@latest

# or install globally
npm install -g @mulmobridge/telegram
TELEGRAM_BOT_TOKEN=your-token TELEGRAM_ALLOWED_CHAT_IDS=123,456 \
  mulmobridge-telegram

# or from the monorepo
yarn telegram
```

## Environment Variables

| Variable | Required | Description | Default |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | BotFather token | - |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Yes | Comma-separated integer chat IDs | empty (deny all) |
| `MULMOCLAUDE_API_URL` | No | Server URL | `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token override | reads from file |
| `TELEGRAM_POLL_TIMEOUT_SEC` | No | Long-poll timeout | `25` |

## Security

The bridge enforces a **chat-ID allowlist**. Only messages from listed chat IDs are forwarded to MulmoClaude. All other messages receive a one-time "Access denied" reply.

## Features

- Long-polling (no webhook setup needed)
- Photo attachment support (downloads and forwards to Claude vision)
- Long-message chunking (splits replies > 4096 chars)
- Server push delivery (Phase B of #268)
- Graceful shutdown on SIGINT

## Ecosystem

Part of the `@mulmobridge/*` package family:

- **@mulmobridge/protocol** — shared types and constants
- **@mulmobridge/client** — socket.io client library
- **@mulmobridge/cli** — interactive terminal bridge
- **@mulmobridge/telegram** — this package
- **@mulmobridge/chat-service** — server-side chat service

## License

MIT
