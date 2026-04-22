# @mulmobridge/irc

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

IRC bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Connects to any IRC server (Libera.Chat, OFTC, self-hosted, etc.).

## Setup

No API keys or bot registration needed — just pick a nickname and connect.

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
IRC_SERVER=irc.libera.chat \
IRC_NICK=mulmo-bot \
IRC_CHANNELS=#your-channel \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/irc

# With real MulmoClaude
IRC_SERVER=irc.libera.chat \
IRC_NICK=mulmo-bot \
IRC_CHANNELS=#your-channel \
npx @mulmobridge/irc
```

## How it works

- **In channels**: the bot responds only when mentioned (`mulmo-bot: what is 2+2?`)
- **In private messages**: the bot responds to everything

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `IRC_SERVER` | Yes | e.g. `irc.libera.chat` |
| `IRC_NICK` | Yes | Bot nickname |
| `IRC_CHANNELS` | Yes | CSV of channels (e.g. `#mulmo,#test`) |
| `IRC_PORT` | No | Default: 6697 (TLS) or 6667 (plain) |
| `IRC_TLS` | No | `true` (default) or `false` |
| `IRC_PASSWORD` | No | NickServ or server password |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token |

## License

MIT
