# @mulmobridge/matrix

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Matrix bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Works with any Matrix homeserver (matrix.org, Element, Synapse, Dendrite, Conduit).

## Setup

### 1. Create a bot account

Register a new user on your Matrix homeserver for the bot. On matrix.org:

```bash
# Using Element: create a new account manually
# Or use the admin API on your self-hosted server
```

### 2. Get an access token

```bash
curl -X POST "https://matrix.org/_matrix/client/v3/login" \
  -H "Content-Type: application/json" \
  -d '{"type":"m.login.password","user":"@mulmo-bot:matrix.org","password":"..."}'
# → { "access_token": "syt_..." }
```

### 3. Invite the bot to a room

In Element or your Matrix client, invite `@mulmo-bot:matrix.org` to the room where you want to use MulmoClaude.

### 4. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
MATRIX_HOMESERVER_URL=https://matrix.org \
MATRIX_ACCESS_TOKEN=syt_... \
MATRIX_USER_ID=@mulmo-bot:matrix.org \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/matrix

# With real MulmoClaude
MATRIX_HOMESERVER_URL=https://matrix.org \
MATRIX_ACCESS_TOKEN=syt_... \
MATRIX_USER_ID=@mulmo-bot:matrix.org \
npx @mulmobridge/matrix
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `MATRIX_HOMESERVER_URL` | Yes | e.g. `https://matrix.org` |
| `MATRIX_ACCESS_TOKEN` | Yes | Bot user's access token |
| `MATRIX_USER_ID` | Yes | e.g. `@mulmo-bot:matrix.org` |
| `MATRIX_ALLOWED_ROOMS` | No | CSV of room IDs (empty = all joined rooms) |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token |

## Notes

- Matrix is an **open, federated protocol**. Your bot can join rooms on any server, not just the one it's registered on.
- No webhook or public URL needed — the bridge connects to the homeserver directly via long-polling sync.
- End-to-end encrypted rooms are **not supported** in this version (the SDK supports it, but key management adds complexity).

## License

MIT
