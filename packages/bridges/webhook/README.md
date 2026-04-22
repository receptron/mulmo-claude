# @mulmobridge/webhook

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new).

Generic HTTP-webhook bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). POST JSON to a local endpoint, get the AI reply back in the response body. Useful developer glue for:

- Shell scripts & cron jobs (`curl` to talk to your agent)
- Zapier / n8n / Make / Pipedream webhooks
- Home Assistant automations
- CI / CD pipelines
- Any HTTP-speaking tool

## Quick start

```bash
# Start the bridge (with MulmoClaude running on :3001)
npx @mulmobridge/webhook

# In another terminal
curl -X POST http://localhost:3009/webhook \
  -H 'Content-Type: application/json' \
  -d '{"chatId":"demo","text":"hello from curl"}'

# → {"ok":true,"reply":"Hello! How can I help?"}
```

## Payload

```json
{
  "chatId": "optional-conversation-id",
  "text":  "what the user said"
}
```

- `text` (required) — the user message, non-empty string.
- `chatId` (optional) — conversation key. Reuse the same value across requests to keep a session. Defaults to `"default"` if omitted.

## Response

**Success (200)**:
```json
{ "ok": true, "reply": "…AI reply…" }
```

**Client error (400)** — malformed body.
**Unauthorized (401)** — secret mismatch.
**Upstream error (502)** — MulmoClaude refused / timed out.

## Environment variables

| Variable            | Required | Default    | Description |
|---------------------|----------|------------|-------------|
| `WEBHOOK_PORT`      | no       | `3009`     | HTTP port |
| `WEBHOOK_PATH`      | no       | `/webhook` | Endpoint path |
| `WEBHOOK_SECRET`    | yes (prod) | —        | Shared secret. Every request must include `x-webhook-secret: <value>` header (constant-time compared). The bridge refuses to start without a secret unless `WEBHOOK_ALLOW_OPEN=1` is also set. |
| `WEBHOOK_ALLOW_OPEN`| no       | —          | Set to `1` to run without `WEBHOOK_SECRET` (local testing only). Prints a loud warning and leaves the endpoint unauthenticated — every POST will drive an LLM call. Do **not** expose publicly. |
| `MULMOCLAUDE_AUTH_TOKEN` | no  | auto       | MulmoClaude bearer token override |
| `MULMOCLAUDE_API_URL` | no     | `http://localhost:3001` | MulmoClaude server URL |

## Examples

### Shell alias

```bash
alias claude-ask='curl -sS -X POST http://localhost:3009/webhook -H "Content-Type: application/json" -d "$(jq -nR --arg t "$1" -- '\''{text:$t}'\'')" | jq -r .reply'
claude-ask "summarize today's calendar"
```

### With secret

```bash
WEBHOOK_SECRET=$(openssl rand -hex 16) npx @mulmobridge/webhook

curl -X POST http://localhost:3009/webhook \
  -H "x-webhook-secret: $WEBHOOK_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"text":"hi"}'
```

### Home Assistant

```yaml
rest_command:
  ask_claude:
    url: http://localhost:3009/webhook
    method: POST
    content_type: application/json
    payload: '{"chatId":"home-assistant","text":"{{ question }}"}'
```

## How it works

1. Express listens on `WEBHOOK_PORT` at `WEBHOOK_PATH`.
2. On POST, the secret (if configured) is checked constant-time. The body is parsed as JSON; `text` is required, `chatId` optional (defaults to `"default"`).
3. The bridge forwards to MulmoClaude via `createBridgeClient(...).send()` and streams the reply back synchronously in the HTTP response body.

Push delivery is **not supported** — this endpoint is request/response only. Use a platform-specific bridge (Telegram, LINE, Slack, …) if you need server-initiated push.

## Security notes

- Run only on `localhost` unless you set `WEBHOOK_SECRET`. Without a secret, anyone reaching the port can converse with your agent.
- HTTPS / reverse-proxy is your responsibility if you expose this beyond localhost.
- The secret is compared in constant time — timing attacks won't leak its length after the first character.
- No rate limiting built in. Layer a reverse proxy (nginx, Cloudflare, etc.) for public exposure.
