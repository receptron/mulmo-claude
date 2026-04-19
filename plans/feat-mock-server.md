# @mulmobridge/mock-server — bridge development & user testing mock

## Vision

MulmoClaude should be accessible from **every messaging app** users already have open — Telegram, LINE, WhatsApp, Slack, Discord, and more. Each platform needs a small bridge process that translates between the platform's protocol and MulmoClaude's socket.io bridge protocol.

The mock server enables **two audiences** to work in parallel:

1. **Bridge developers** (us or third-party) build and test bridges without running the full MulmoClaude stack or needing a Claude API key.
2. **End users** validate that their bridge setup works correctly. When something fails, they capture the diagnostic log and send it to us — the log is detailed enough for us (or Claude) to diagnose the bug without follow-up questions.

The goal is to ship bridges for as many messaging platforms as possible, get users to test them, and iterate fast on bug reports.

## Target messaging platforms

Bridges we want to support (checked = shipped, unchecked = planned):

| Platform | Status | Bot/API model | Complexity |
|---|---|---|---|
| **CLI** | ✅ shipped (`@mulmobridge/cli`) | stdin/stdout | Trivial |
| **Telegram** | ✅ shipped (`@mulmobridge/telegram`) | Bot API long-polling | Low |
| **LINE** | 🔲 planned | Messaging API (webhook) | Medium (reply token 1-min expiry) |
| **Slack** | 🔲 planned | Socket Mode or Events API | Medium (3s ack requirement) |
| **Discord** | 🔲 planned | Gateway + REST | Medium (interaction tokens) |
| **WhatsApp** | 🔲 planned | Cloud API (webhook) | Medium (24h messaging window) |
| **Facebook Messenger** | 🔲 planned | Send/Receive API (webhook) | Medium |
| **Microsoft Teams** | 🔲 planned | Bot Framework | High (Azure registration) |
| **X (Twitter) DM** | 🔲 planned | Account Activity API | High (strict rate limits) |
| **WeChat** | 🔲 planned | Official Account API | High (China-specific infra) |
| **Signal** | 🔲 planned | signal-cli (unofficial) | Medium (no official bot API) |
| **Matrix / Element** | 🔲 planned | Client-Server API | Low (open protocol) |
| **Google Chat** | 🔲 planned | Chat API (webhook or service account) | Medium |
| **Zulip** | 🔲 planned | Bot API | Low |
| **Mattermost** | 🔲 planned | Bot API (webhook or WebSocket) | Low |
| **IRC** | 🔲 planned | Plain TCP/TLS | Low |

Each bridge is a standalone npm package under `@mulmobridge/<platform>` (or a community-maintained repo in any language). The mock server lets every one of these be developed and tested independently.

## Mock server goal

`npx @mulmobridge/mock-server` starts a local mock MulmoClaude server that speaks the full bridge protocol (socket.io on `/ws/chat` + bearer auth). Bridge developers connect their bridges to it and verify everything works — handshake, message/ack, attachments, streaming, push — without running the real MulmoClaude stack or needing a Claude API key.

## Why a mock server (not just "run MulmoClaude")

Bridge development currently requires a running MulmoClaude instance, which means cloning the repo, `yarn install`, `.env` setup, and a valid Claude API key. This is a high barrier for:

- Third-party bridge authors (Python, Go, Rust) who just want to test the socket.io protocol
- CI pipelines that validate bridge code without hitting a real LLM
- Users who want to verify their bridge config before connecting to the real server
- Local development iteration (fast restart, no 10s agent round-trip)

A mock server removes all of that. The bridge under test connects, sends messages, gets predictable responses, and the developer verifies their code works.

## Scope

### In scope

1. **Full socket.io handshake** — same `auth: { transportId, token }` as production. Fixed test token `mock-test-token` (configurable via `--token`).
2. **`message` event with ack** — accepts `{ externalChatId, text, attachments? }`, returns `{ ok: true, reply: "..." }`.
3. **Echo mode (default)** — reply = the user's text, prefixed with `[echo] `. Attachments listed as `[attachment: <mimeType> <size>B]`.
4. **Streaming text chunks** — emits `textChunk` events character-by-character (or word-by-word) with configurable delay before the final ack, so bridges can test their streaming display.
5. **`push` event** — `POST /mock/push` HTTP endpoint to trigger a server→bridge push to a specific `transportId` + `chatId`. Lets the developer simulate scheduled notifications.
6. **Slash commands** — same as production (`/help`, `/reset`, `/roles`, `/role <id>`, `/status`). Hardcoded responses, no LLM.
7. **Rejection scenarios** — `--reject-auth` flag makes the server reject all connections (for testing error handling). `--slow` adds a configurable delay to replies.
8. **Bearer auth rejection testing** — correct token connects; wrong token gets `connect_error` with `invalid token`.
9. **Attachment echo** — lists received attachments in the reply text so the bridge developer can verify they were sent correctly.
10. **CLI output** — log every message/push/connection to stdout so the developer sees the traffic in real time.

### Out of scope

- Real LLM invocation (that's what MulmoClaude is for)
- Workspace persistence (no jsonl, no meta files)
- Web UI
- MCP tools
- pub/sub for browser sessions

## Usage

```bash
# Default: echo mode, token = mock-test-token, port 3001
npx @mulmobridge/mock-server

# Custom port + token
npx @mulmobridge/mock-server --port 4000 --token my-secret

# Simulate slow responses (2 second delay)
npx @mulmobridge/mock-server --slow 2000

# Reject all auth (test error handling)
npx @mulmobridge/mock-server --reject-auth
```

Bridge connects:

```bash
MULMOCLAUDE_AUTH_TOKEN=mock-test-token MULMOCLAUDE_API_URL=http://localhost:3001 npx @mulmobridge/cli
```

## Reply modes

| Mode | Flag | Reply behavior |
|---|---|---|
| **echo** (default) | — | `[echo] <user text>` + attachment summary |
| **fixed** | `--reply "custom text"` | Always returns the given string |
| **slow** | `--slow <ms>` | Adds delay before reply (simulates agent thinking) |
| **streaming** | `--stream` | Emits `textChunk` events word-by-word with 50ms gaps, then final ack |
| **error** | `--error` | Always returns `{ ok: false, error: "simulated error", status: 500 }` |

Modes are composable: `--stream --slow 1000` delays 1s then streams.

## Push simulation

```bash
# While mock server is running, trigger a push from another terminal:
curl -X POST http://localhost:3001/mock/push \
  -H "Content-Type: application/json" \
  -d '{"transportId":"cli","chatId":"terminal","message":"Hello from push!"}'
```

The mock server delivers the push to all connected bridges with matching `transportId`.

## Architecture

```text
packages/
  mock-server/
    src/
      index.ts          ← CLI entry (arg parsing + server start)
      server.ts         ← Express + socket.io setup
      handlers.ts       ← message handler (echo/fixed/error), slash commands
      streaming.ts      ← textChunk emission with configurable delay
    package.json        ← bin: { "mock-server": "./dist/index.js" }
    tsconfig.json
```

Dependencies: `express`, `socket.io`, `@mulmobridge/protocol` (for constants only). No `@mulmobridge/client` (that's for bridges, not the server).

## Slash commands (hardcoded)

| Command | Response |
|---|---|
| `/help` | Lists all commands |
| `/reset` | `"Session reset. Role: general"` |
| `/roles` | `"Available roles:\n  general — General Assistant\n  office — Office Guide"` |
| `/role <id>` | `"Switched to <id>. New session started."` |
| `/status` | `"Role: general\nSession: mock-<transportId>-<chatId>\nLast activity: <now>"` |

## Console output

```
[mock] listening on http://localhost:3001 (token: mock-test-token)
[mock] connected: transportId=cli sid=abc123
[mock] ← message chat=terminal text="hello" (12 chars)
[mock] → ack ok=true reply="[echo] hello" (18 chars)
[mock] ← message chat=terminal text="analyze" +attachment(image/jpeg, 45KB)
[mock] → ack ok=true reply="[echo] analyze\n[attachment: image/jpeg 46080B]"
[mock] → push transportId=cli chatId=terminal message="scheduled reminder"
[mock] disconnected: transportId=cli sid=abc123
```

## Diagnostic logging — "paste this to report a bug"

The mock server's primary purpose is letting bridge developers test and **report problems** back to us. The log output must be self-contained: if a user pastes the terminal output into a GitHub issue, we (or Claude) can diagnose the bug without asking follow-up questions.

### `--verbose` flag

Default output shows one-line summaries (the "Console output" above). `--verbose` (or `-v`) adds full protocol traces:

```
[mock] ══════════════════════════════════════════════════════
[mock] @mulmobridge/mock-server v0.1.0
[mock] node: v24.12.0 | os: darwin arm64 | socket.io: 4.8.3
[mock] listening: http://localhost:3001
[mock] token: mock-test-token
[mock] mode: echo | slow: 0ms | stream: off
[mock] ══════════════════════════════════════════════════════

[mock] 12:34:56.789 CONNECT  sid=abc123 transportId=telegram
[mock]   auth: { transportId: "telegram", token: "mock-te…" (valid) }
[mock]   headers: { origin: "...", user-agent: "..." }

[mock] 12:34:57.012 ← MESSAGE  sid=abc123
[mock]   payload: {
[mock]     externalChatId: "12345",
[mock]     text: "hello world",
[mock]     attachments: [
[mock]       { mimeType: "image/jpeg", data: "<base64 45056B>", filename: "photo.jpg" }
[mock]     ]
[mock]   }

[mock] 12:34:57.015 → ACK  sid=abc123  latency=3ms
[mock]   ack: { ok: true, reply: "[echo] hello world\n[attachment: image/jpeg 45056B photo.jpg]" }

[mock] 12:35:10.000 → PUSH  sid=abc123
[mock]   payload: { chatId: "12345", message: "scheduled reminder" }

[mock] 12:35:20.000 DISCONNECT  sid=abc123  reason=client namespace disconnect
[mock]   session duration: 23.2s | messages: 1 | pushes: 1
```

### What the log captures (and why)

| Field | Why we need it |
|---|---|
| **Mock server version** | "Works on 0.1.0 but not 0.1.1" — version-specific regressions |
| **Node + OS + socket.io version** | Platform-specific bugs (Windows path handling, socket.io transport negotiation) |
| **Token validity** | "valid" / "rejected: mismatch" / "rejected: missing" — instant auth debugging |
| **Full auth payload** | Shows exactly what the bridge sent in handshake. Token truncated for security. |
| **Full message payload** | Text, attachments (with MIME type + size + filename). Attachment data is shown as `<base64 NB>` (size only, not the content — avoids multi-MB log lines) |
| **Ack payload** | Exact reply the mock sent back. Bridge can compare against what it displayed |
| **Latency** | Time between receiving the message and sending the ack. Helps spot "my bridge times out" issues (was the mock slow or the bridge timeout too short?) |
| **Push payloads** | Full `{ chatId, message }` — the bridge developer can verify their push handler received it |
| **Disconnect reason** | socket.io disconnect reason string — "transport close" vs "client namespace disconnect" vs "ping timeout" |
| **Session summary** | Duration + message count + push count — quick triage of "it connected but nothing happened" |
| **connect_error details** | If handshake fails: full error message + the auth payload the client sent |

### Error logging

Errors include stack traces and the request that caused them:

```
[mock] 12:34:57.012 ERROR  sid=abc123
[mock]   event: message
[mock]   payload: { externalChatId: "", text: "hello" }
[mock]   error: ValidationError: externalChatId is required
[mock]     at validatePayload (server.ts:45)
[mock]     at handleMessage (handlers.ts:12)
```

### `--log-file <path>`

Write the verbose log to a file (always verbose, regardless of `--verbose` flag on console). Users can attach this file to bug reports:

```bash
npx @mulmobridge/mock-server --log-file debug.log
# ... reproduce the bug ...
# debug.log is ready to paste into a GitHub issue
```

### Report template

When a user runs `--verbose`, the mock prints a hint at the end:

```
[mock] ──────────────────────────────────────────────────────
[mock] To report a bug, paste the output above into:
[mock]   https://github.com/receptron/mulmoclaude/issues/new
[mock] Include: what you expected vs. what happened.
[mock] ──────────────────────────────────────────────────────
```

## Implementation phases

### Phase 1 (this PR)

- `packages/mock-server/` package with bin entry
- Echo mode + slash commands + bearer auth
- Push endpoint
- `--port`, `--token`, `--slow`, `--error`, `--reject-auth` flags
- `--verbose` / `-v` diagnostic logging (full protocol trace)
- `--log-file <path>` for bug report capture
- Bug report hint printed on exit

### Phase 2 (follow-up)

- `--stream` mode with textChunk emission
- `--scenario <file>` — load a JSON file of canned request→response pairs for deterministic integration testing

## User testing workflow

The intended flow for a user testing a new bridge:

```
1. User installs the bridge:
   npx @mulmobridge/telegram --help

2. User starts the mock server (no MulmoClaude needed):
   npx @mulmobridge/mock-server --verbose

3. User starts the bridge pointing at the mock:
   MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
   MULMOCLAUDE_API_URL=http://localhost:3001 \
   TELEGRAM_BOT_TOKEN=... \
   npx @mulmobridge/telegram

4. User sends a message from their phone → bridge forwards
   to mock → mock echoes → bridge replies on the phone.

5. If something breaks, user copies the mock server terminal
   output and opens a GitHub issue. The log has everything we
   need to diagnose: protocol version, auth result, message
   payloads, timing, error stack traces.

6. Once verified with the mock, user switches to real MulmoClaude:
   MULMOCLAUDE_API_URL=http://localhost:3001 \
   npx @mulmobridge/telegram
   (same command, just without the mock-test-token override)
```

This separates "does my bridge config work?" from "does MulmoClaude's LLM work?" — the mock answers the first question without the second being a variable.

## Related

- `docs/bridge-protocol.md` — the contract this mock implements
- `packages/client/` — TS bridge client library (test target)
- `packages/cli/` — reference bridge (test subject)
- `packages/telegram/` — production bridge (test subject)
