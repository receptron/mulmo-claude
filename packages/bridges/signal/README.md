# @mulmobridge/signal

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Signal bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Talks to a locally running [signal-cli-rest-api](https://github.com/bbernhard/signal-cli-rest-api) daemon — typically a Docker container — over WebSocket (incoming) + REST (outgoing). The daemon handles the actual Signal network, so this bridge stays stateless and lightweight.

## Architecture

```text
  Signal network
        │
        ▼
┌────────────────────────┐      ┌───────────────────────────┐
│ signal-cli-rest-api    │◄────►│ @mulmobridge/signal        │────► MulmoClaude
│ (Docker on your host)  │      │ (WebSocket receive,        │
│ port 8080              │      │  REST send)                │
└────────────────────────┘      └───────────────────────────┘
```

## Setup

### 1. Run signal-cli-rest-api

Easiest way — Docker:

```bash
docker run -d --name signal-api --restart=always \
  -p 8080:8080 \
  -v $HOME/.local/share/signal-api:/home/.local/share/signal-cli \
  -e 'MODE=json-rpc' \
  bbernhard/signal-cli-rest-api
```

### 2. Register (or link) a Signal number

Two options — pick one:

**Register a new number** (you'll receive a verification SMS / voice call):

```bash
curl -X POST http://localhost:8080/v1/register/+81901234567
curl -X POST http://localhost:8080/v1/register/+81901234567/verify/123456
```

**Link as a secondary device** (uses your existing Signal account; pair via QR code — see [signal-cli-rest-api docs](https://github.com/bbernhard/signal-cli-rest-api#link-a-device)).

### 3. Run the bridge

```bash
# Testing with mock server
npx @mulmobridge/mock-server &
SIGNAL_API_URL=http://localhost:8080 \
SIGNAL_NUMBER=+81901234567 \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/signal

# With real MulmoClaude
SIGNAL_API_URL=http://localhost:8080 \
SIGNAL_NUMBER=+81901234567 \
npx @mulmobridge/signal
```

Send a Signal message to the bot number from another Signal account — you'll get a reply.

## Environment variables

| Variable                 | Required | Default | Description |
|--------------------------|----------|---------|-------------|
| `SIGNAL_API_URL`         | yes      | —       | signal-cli-rest-api base URL, e.g. `http://localhost:8080` |
| `SIGNAL_NUMBER`          | yes      | —       | Bot's registered Signal number in E.164 form (e.g. `+81901234567`) |
| `SIGNAL_ALLOWED_NUMBERS` | no       | (all)   | CSV of sender numbers allowed, e.g. `+81901111111,+81902222222`. Empty = accept everyone |
| `MULMOCLAUDE_AUTH_TOKEN` | no       | auto    | MulmoClaude bearer token override |
| `MULMOCLAUDE_API_URL`    | no       | `http://localhost:3001` | MulmoClaude server URL |

## How it works

1. The bridge opens a WebSocket to `ws://<SIGNAL_API_URL>/v1/receive/<SIGNAL_NUMBER>`. The daemon relays every inbound Signal envelope to this stream as JSON.
2. For each envelope containing a `dataMessage.message`, the bridge verifies the sender is in the allowlist (if set), then forwards the text to MulmoClaude keyed by the sender's phone number.
3. Replies are POSTed back via `POST /v2/send` with `number` (bot) + `recipients` (sender), chunked at 4 000 chars.
4. Stream drops are recovered via exponential backoff reconnect.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `stream error: ECONNREFUSED` | daemon not running or wrong port | `docker logs signal-api`; check `SIGNAL_API_URL` |
| `send failed: 400` | number not registered to the daemon | Re-register or re-link |
| No messages appear | daemon not in `json-rpc` mode | Restart the container with `-e MODE=json-rpc` |
| Duplicate replies | Multiple bridge processes attached to the same daemon | Ensure only one instance is running |

## Security notes

- signal-cli-rest-api stores the Signal private key under its data volume. **Back up and protect this volume** — loss = re-registration; leak = account impersonation.
- Bind the daemon to `localhost` (or a private network) — never expose port 8080 to the public internet.
- Use `SIGNAL_ALLOWED_NUMBERS` to limit who can converse with your agent. Signal doesn't have spam filtering as strict as some platforms.
- A dedicated Signal number is strongly recommended. Linking as a secondary device reuses your personal account, which means bot replies come from your own identity.
