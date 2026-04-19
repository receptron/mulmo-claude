# feat(bridges): Telegram bridge

Tracks issue #321.

## Goal

Second bridge after CLI. Users run `yarn telegram` next to
`yarn dev`, chat with a Telegram bot they created via BotFather,
and MulmoClaude responds as if the chat came from any other
front-end. Target audience is non-dev friends / family the
operator shares the bot with.

Depends on the shared client lib from #320 (merged).

## Wire-level plumbing

Two Telegram Bot API calls, raw `fetch` — no `node-telegram-bot-api`
or `grammy` dependency:

- `getUpdates` with `timeout=25` (long polling). Returns inbound
  messages and a monotonic `update_id` for offset tracking.
- `sendMessage` to deliver a text reply.

Two MulmoClaude client calls, via `createBridgeClient` from
`bridges/_lib/client.ts`:

- `client.send(externalChatId, text)` — Telegram `chat.id` →
  `externalChatId`; Telegram `message.text` → `text`; wait for the
  ack; call `sendMessage`.
- `client.onPush((ev) => telegramSendMessage(ev.chatId, ev.message))` —
  server-originated pushes (Phase B #318).

The bridge stays stateless. All chat state lives in MulmoClaude.

## Allowlist (mandatory — first world-facing surface)

Telegram bots are reachable by any Telegram user who knows the
bot's username. Unlike CLI / HTTP (both localhost-gated by bearer
token), this is the first bridge that accepts input from the open
internet. Without an allowlist, anyone could:

- Invoke Claude on the operator's machine
- Burn API credits
- Touch the workspace via prompts

**Rules:**

- `TELEGRAM_ALLOWED_CHAT_IDS` env var, comma-separated integer chat
  IDs (Telegram chat IDs are numeric — positive for user chats,
  negative for groups).
- Parse at startup. Empty / unset → empty allowlist → deny
  everyone. (Don't default-allow; a blank env is almost always a
  misconfiguration.)
- On a message from a non-allowed chat:
  - Reply once with
    `"Access denied. Contact the operator to be added to the allowlist."`
  - Log at `warn` with the rejected chat ID + username so the
    operator can decide whether to add them.
  - Do NOT forward to MulmoClaude.
- On a message from an allowed chat:
  - Log at `info` with chat ID + username (audit trail).
  - Forward normally.

Edge cases:
- `TELEGRAM_ALLOWED_CHAT_IDS` with a non-integer entry → refuse to
  start, exit with an error. Silent ignore would hide typos that
  would otherwise allow nobody and confuse the operator.
- Also gate `onPush` callbacks: only call `sendMessage` if the
  destination `chatId` is in the allowlist. Defense in depth
  against a buggy / malicious task-manager sending to arbitrary
  chats.

## Scope

### In

- `bridges/telegram/index.ts` — polling loop, glue between Telegram
  and `createBridgeClient`. ~100 lines.
- `bridges/telegram/api.ts` — raw fetch wrappers, just
  `getUpdates` + `sendMessage` + the shared result types. ~60
  lines.
- `bridges/telegram/allowlist.ts` — parse + check
  `TELEGRAM_ALLOWED_CHAT_IDS`, exported factory so tests can build
  one without touching env.
- `package.json` — `"telegram": "tsx bridges/telegram/index.ts"`
  script.
- Tests (`test/bridges/telegram/`):
  - `test_allowlist.ts` — parse edge cases, contains checks.
  - `test_api.ts` — fetch-mocked `getUpdates` / `sendMessage`.
  - `test_index.ts` — integration with a stubbed Telegram API and
    a stubbed bridge client: allowed messages forward, denied
    messages reply with access-denied, push events deliver through
    the allowlist.
- End-user docs:
  - `docs/message_apps/telegram/README.md` (English)
  - `docs/message_apps/telegram/README.ja.md` (Japanese)
  - Both cover: BotFather setup, env vars, `yarn telegram`,
    finding your chat ID, allowlist management, troubleshooting.
- `docs/developer.md` — one-line pointer to the Telegram docs /
  env vars section.

### Out

- Inline keyboards / rich message formatting
- Non-text content (photos, audio, files)
- Webhook mode (long-polling only — no public URL needed)
- Always-on VM setup (the operator runs it on their own machine;
  docs mention "laptop has to be open" as the obvious limit)
- Multi-bot support (one bot token per bridge process; run
  multiple `yarn telegram` processes with different transportIds
  if you need many bots)

## Env surface

| Variable | Required | Meaning |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | BotFather token. Kept secret, never logged. |
| `TELEGRAM_ALLOWED_CHAT_IDS` | Yes (else denies all) | CSV of integer chat IDs |
| `MULMOCLAUDE_API_URL` | No | Defaults `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Overrides the `~/mulmoclaude/.session-token` file read |
| `TELEGRAM_POLL_TIMEOUT_SEC` | No | Defaults 25 (Telegram recommendation); env for testing |

All read via a small `env.ts` inside `bridges/telegram/` to keep it
self-contained. We don't route through `server/system/env.ts` because the
bridge is a separate process family.

## Operator story (docs outline)

1. Open Telegram, find `@BotFather`, send `/newbot`, answer
   prompts (display name + unique username ending in "bot"). You
   receive a token like `1234567890:AA…`.
2. Set `TELEGRAM_BOT_TOKEN` and (initially) empty
   `TELEGRAM_ALLOWED_CHAT_IDS`. Run `yarn telegram`. Message the
   bot from your own Telegram account. The bridge logs the
   rejection: `chat 987654 denied (user @alice)`. Copy the number
   into `TELEGRAM_ALLOWED_CHAT_IDS`. Restart.
3. To add a friend: they message the bot, the bridge logs their
   chat ID, operator adds it to the allowlist and restarts.

## Security notes

- Bot token leak surface: env var, process listing
  (`ps` / `/proc`). Same posture as other secrets — document
  "treat like a password".
- Allowlist check happens in the bridge process, not the server.
  The server sees `transportId=telegram` + an `externalChatId`
  string; it has no concept of "this is allowed". Keeping the
  check bridge-side is consistent with the platform-specifics
  boundary and avoids pushing Telegram knowledge into
  `chat-service`.
- Logging user-provided text at `info` is avoided — message
  contents stay out of logs; only the chat ID + username +
  message-length are logged. Operators who need full audit can
  raise the log level or add a platform-side Telegram log.

## Risk / open items

- Telegram's `getUpdates` long-polling loops indefinitely. Clean
  shutdown on `SIGINT` — abort the in-flight fetch with
  `AbortController`, close the socket cleanly. Docs mention this
  as a nicety but it shouldn't block the first cut.
- Message length: Telegram caps at 4096 chars. For now, split
  naively on 4096 and send as multiple messages. Pretty format
  (markdown, code-block preservation across splits) is a follow-up.
- Rate limits: Telegram allows ~30 messages/sec per bot. Not a
  concern for a personal bot but document the limit.
