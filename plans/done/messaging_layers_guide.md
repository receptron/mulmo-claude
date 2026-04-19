# Messaging Transport Architecture — Layer Guide

This is a companion to [`messaging_transports.md`](messaging_transports.md). The
plan doc is terse and assumes you already understand the architecture. This
guide explains the layer structure from the ground up so a newcomer can read
the plan and contribute to it.

> **Contract decisions (resolved in #273)** — see the plan doc for the authoritative list. Short version:
> URL prefix `/api/transports/…`; state field `chatSessionId`; `startChat()` returns `{ kind: "started" | "error", … }` and kicks post-processing from `runAgentInBackground()`'s `finally`; text chunks arrive as `event.message`; `/role` resets; transport polling uses `setInterval`, not the task-manager.

---

## Why have layers at all?

Naively, if you only wanted Telegram support, you might write:

```ts
// naive implementation — do NOT do this
while (true) {
  const messages = await telegramApi.getMessages();
  for (const msg of messages) {
    const reply = await runAgent(msg.text); // ← directly invokes the agent
    await telegramApi.sendMessage(msg.chatId, reply);
  }
}
```

This works for Telegram alone. The problems show up when you want to add
more platforms:

1. Slack support → nearly-identical loop copied into `slack.ts`
2. LINE support → another copy
3. Every time the agent-invocation contract changes (new lifecycle hook,
   new logging requirement), **all five copies need to be updated in lockstep**
4. PR #106 hit exactly this — calling `runAgent()` directly bypassed
   session persistence, journal triggers, chat-index, and wiki-backlinks,
   so the Telegram bot was technically working but producing "ghost
   sessions" invisible to the rest of the system.

The first instinct is to solve this with an in-process abstraction layer —
a shared `relayMessage()` function that all platform adapters call. That
helps with duplication, but every platform's code, dependencies, and
failure modes still live inside the MulmoClaude server process. A bad
Telegram API response could crash the whole server. Every bridge update
requires a server restart.

The real fix is **process isolation**: bridges run as separate processes
and talk to MulmoClaude via HTTP, just like the Web UI does.

---

## The five layers at a glance

```text
┌────────────────────────────────────────────────────────────┐
│ Layer 1: External platforms                                │
│   Telegram / LINE / WhatsApp / Slack / Twitter             │
│   (services we don't own — we speak their protocol)        │
└─────────────┬──────────────────────────────────────────────┘
              │ HTTP APIs / webhooks
┌─────────────▼──────────────────────────────────────────────┐
│ Layer 2: Bridge processes (out-of-process, per platform)   │
│   bridges/telegram/     ← child process of MulmoClaude     │
│   bridges/line/         ← child process of MulmoClaude     │
│   bridges/slack/ …      ← child process of MulmoClaude     │
│   Speaks one platform's protocol, and ONLY that protocol.  │
│   Stateless — knows nothing about sessions or roles.       │
└─────────────┬──────────────────────────────────────────────┘
              │ socket.io /ws/chat  (or HTTP POST /api/transports/…/chats/…)
┌─────────────▼──────────────────────────────────────────────┐
│ Layer 3: Chat Service API + state (server-side)            │
│   server/api/chat-service/index.ts       ← factory (router+socket) │
│   server/api/chat-service/socket.ts      ← socket.io transport │
│   server/api/chat-service/relay.ts       ← shared request flow │
│   server/api/chat-service/chat-state.ts  ← session pointer     │
│   server/api/chat-service/commands.ts    ← /reset, /role, etc. │
│   Receives raw text, manages sessions, invokes the agent.  │
└─────────────┬──────────────────────────────────────────────┘
              │ startChat() — existing public entry point
┌─────────────▼──────────────────────────────────────────────┐
│ Layer 4: MulmoClaude core (already exists, not modified)   │
│   startChat() — session creation, jsonl persistence,       │
│                 background agent launch                    │
│                 (post-processing runs in finally, detached)│
│   runAgent() — Claude CLI subprocess orchestration         │
│   session-store — in-memory chatSessionId → state          │
│   pub/sub — session event distribution                     │
└─────────────┬──────────────────────────────────────────────┘
              │ subprocess calls
┌─────────────▼──────────────────────────────────────────────┐
│ Layer 5: Claude CLI + workspace                            │
│   claude (Anthropic Agent SDK CLI)                         │
│   ~/mulmoclaude/ — files are the source of truth           │
└────────────────────────────────────────────────────────────┘
```

Layers 4 and 5 exist today. Layers 2 and 3 are what `messaging_transports.md`
proposes to build.

**The critical boundary is between Layer 2 and Layer 3.** It's an HTTP
API across a process boundary. This means:

- A bridge crash doesn't take down the server
- A bridge can be restarted without restarting MulmoClaude
- A bridge can be developed in any language
- Adding a new bridge requires **zero server changes**

---

## What each layer does

### Layer 1 — External platforms

These are services we **don't control**. Each has its own:

- Authentication model (bot tokens, OAuth, signing secrets)
- Ingress pattern (polling vs webhooks)
- Message format (text limits, markup flavor, media handling)
- Rate limits and SLA constraints (Telegram's long-polling timeout,
  Slack's 3-second ACK, LINE's 1-minute reply-token, WhatsApp's 24-hour
  messaging window, Twitter/X's strict per-app and per-user rate limits)

Our code **conforms** to each of these — we can't change them. Everything
above this layer is under our control.

### Layer 2 — Bridge processes

Per-platform code running as **separate child processes** of MulmoClaude.
The wire protocol is **socket.io** on `/ws/chat` (see issue #268 /
`plans/feat-chat-socketio.md`). The handshake carries the same
bearer token (#272) as the HTTP path, via `auth.token`. The legacy HTTP
endpoint `POST /api/transports/:transportId/chats/:externalChatId` is
kept for backwards compatibility and will be deprecated in Phase D.
New bridges should use socket.io; the event shape mirrors the HTTP body
(`{ externalChatId, text }`), and the ack callback receives the reply.

**Bidirectional traffic:**

- **Bridge → server** (Phase A): `emit("message", { externalChatId, text }, ack)` — the ack callback receives the assistant reply.
- **Server → bridge** (Phase B, `plans/feat-chat-socketio-phase-b.md`): each bridge joins room `bridge:${transportId}` on connect. Server code calls `chatService.pushToBridge(transportId, chatId, message)` to deliver a scheduled / event-driven message. If no bridge is connected, the push is held in an in-memory FIFO queue per-transport and drains to the next joining socket.

Each bridge is a small, self-contained program:

```text
bridges/telegram/
  index.ts   ← Poll loop: getUpdates → POST to Chat Service API → sendMessage
  api.ts     ← Telegram API wrappers (sendMessage, getUpdates, sendTyping)
```

**A bridge's entire job:**

1. **Inbound**: receive a message from the platform → extract chat ID
   and text → `POST /api/transports/{transportId}/chats/{externalChatId}` with `{ text }`
2. **Outbound**: receive the response → send it back via the platform's
   API

**What a bridge does NOT know about:**

- Session IDs (the server manages the active session pointer)
- Roles (the server handles `/role` commands)
- Commands (the server parses `/reset`, `/help`, etc.)
- `runAgent()` or `startChat()`
- Pub/sub channels
- The workspace filesystem
- Any other bridge's existence

Here's the Telegram bridge in its entirety:

```ts
const API_URL = process.env.MULMOCLAUDE_API_URL!;
const TRANSPORT_ID = process.env.MULMOCLAUDE_TRANSPORT_ID!;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

let offset = 0;

async function poll() {
  const updates = await telegramGetUpdates(BOT_TOKEN, offset);
  for (const update of updates) {
    offset = update.update_id + 1;
    const chatId = String(update.message.chat.id);
    const text = update.message.text?.trim();
    if (!text) continue;

    await telegramSendTyping(BOT_TOKEN, chatId);

    const res = await fetch(
      `${API_URL}/api/transports/${TRANSPORT_ID}/chats/${chatId}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      },
    );
    const { reply } = await res.json();

    await telegramSendMessage(BOT_TOKEN, chatId, reply);
  }
}

// Polling cadence is a per-transport concern, driven by a plain
// setInterval inside the bridge process. We don't register this with
// the server-side task-manager because that's for cron-like workspace
// maintenance (default tick 60s) and would miss sub-minute polls.
setInterval(poll, 5000);
```

~30 lines of logic. If Telegram changes their API, **only this file
changes**. The server, other bridges, and the Web UI are completely
unaffected.

### Layer 3 — Chat Service API + state (server-side)

This is the brain. When a bridge sends
`POST /api/transports/telegram/chats/123 { text: "hello" }`, Layer 3:

1. Looks up chat state for `telegram/123` on disk
2. If no state exists, creates a new session `telegram-123-{timestamp}`
3. Checks if the text is a command (`/reset`, `/role`, `/help`, etc.)
   - If so, executes it and returns the result immediately
4. If not a command, calls `startChat()` with the active session ID
5. Subscribes to pub/sub for session events
6. Collects text chunks into a complete reply
7. Returns `{ reply: "..." }` to the bridge

Three sub-modules:

#### 3a. `chat-state.ts` — the active session pointer

Every external chat gets mapped to one active MulmoClaude session,
persisted as a JSON file:

```json
// ~/mulmoclaude/transports/telegram/chats/123.json
{
  "externalChatId": "123",
  "chatSessionId": "telegram-123-1713100000",
  "roleId": "general",
  "claudeSessionId": "xyz-789",
  "startedAt": "2026-04-14T12:00:00Z",
  "updatedAt": "2026-04-14T12:30:00Z"
}
```

The field name `chatSessionId` matches the `startChat()` parameter name, so the value can be forwarded without renaming.

The state store API:

- `get(transportId, externalChatId)` — load or return null
- `set(transportId, state)` — persist (atomic write)
- `reset(transportId, externalChatId, roleId?)` — create a fresh
  session (new `chatSessionId`), move the pointer. The old session is
  **not deleted** — it stays in the sidebar for reference
- `connect(transportId, externalChatId, chatSessionId)` — point this
  transport+externalChatId at an existing MulmoClaude session (called
  from the Web UI's "Connect to Telegram" action)

**Session ID format**: `{transportId}-{externalChatId}-{timestamp}`
(e.g. `telegram-123-1713100000`). This makes the origin visible in the
Web UI sidebar at a glance.

Path safety is enforced via `resolveWithinRoot()` so a malicious
external ID can't escape the transport directory.

#### 3b. `commands.ts` — slash commands (server-side)

A user typing `/role artist` or `/reset` gets the same behavior
regardless of which platform they're on. The server handles all commands
— bridges just forward raw text:

```ts
// Inside the Chat Service API handler:
const command = parseCommand(text);
if (command) {
  const result = await executeCommand(command, chatState);
  if (result.nextState) await chatStateStore.set(transportId, result.nextState);
  return res.json({ reply: result.reply });
}

// Not a command — relay through startChat(). Contract:
//   StartChatParams = { message, roleId, chatSessionId, selectedImageData? }
//   StartChatResult = { kind: "started", chatSessionId } | { kind: "error", error, status? }
const result = await startChat({
  message: text,
  roleId: chatState.roleId,
  chatSessionId: chatState.chatSessionId,
});
if (result.kind === "error") {
  return res.status(result.status ?? 500).json({ reply: `Error: ${result.error}` });
}
// Agent is running in the background — subscribe to the session
// channel, concatenate `event.message` chunks, and return the full
// text on session_finished.
```

Available commands: `/reset`, `/help`, `/roles`, `/role <id>`, `/status`.
`/role <id>` follows the same "new session on switch" rule as the Web UI (see `src/config/roles.ts`): switching role resets conversation context.

#### 3c. Session model — one pointer per chat

MulmoClaude's Web UI supports multiple sessions (visible in the sidebar),
but a messaging app is a single continuous thread. How do we bridge
these two worlds?

**Each messaging chat has exactly one "active session pointer"**, managed
entirely by the server. The bridge never sees session IDs.

```text
Telegram chat 123
  ┌──────────────────────────────────────────┐
  │ active session pointer:                  │
  │   chatSessionId = "telegram-123-1713100000"  │───► jsonl, sidebar, etc.
  │                                          │
  │ Previous sessions:                       │
  │   (still in sidebar,                     │
  │    just not "active" here)               │
  └──────────────────────────────────────────┘
```

**From the messaging app (via bridge → Chat Service API):**

- First message ever → server creates `telegram-{chatId}-{timestamp}`,
  sets the pointer
- Subsequent messages → server routes to the same session via the pointer
- `/reset` → server creates a **new** session, moves the pointer. The
  old session stays in the sidebar — it's not deleted
- `/role artist` → server creates a new session with a different role,
  moves the pointer

**From the Web UI:**

- Any messaging session appears in the sidebar like a normal session.
  The user can open it and continue the conversation from the browser
- "Connect to Telegram" (calls `POST /api/transports/telegram/chats/{externalChatId}/connect`) →
  reassigns the pointer for that chat to the currently-open browser session

**Why the server owns this, not the bridge:** the `/connect` flow
originates from the Web UI and needs to update the pointer. If the
pointer lived in the bridge, the Web UI would need a way to talk to
the bridge — adding complexity. With the pointer on the server, both
the bridge (via Chat Service API) and the Web UI (via the same API)
can manipulate it through a single interface.

### Layer 4 — MulmoClaude core (existing)

We don't touch this layer in the messaging work — we just use it.

`startChat()` is the public entry point:

```text
startChat()          // returns { kind: "started", chatSessionId } immediately
  ├─ Validate params ({ message, roleId, chatSessionId, selectedImageData? })
  ├─ Write / backfill the meta file with firstUserMessage
  ├─ Append user message to jsonl
  ├─ Register in session-store (so the sidebar can see it)
  ├─ beginRun() — mark session running (409 if already running)
  └─ runAgentInBackground()   // detached; errors surface via pub/sub
       ├─ runAgent()
       │    ├─ spawn claude CLI subprocess
       │    ├─ emit text events (event.message) to pub/sub as tokens arrive
       │    ├─ emit tool_call / tool_call_result events as plugins run
       │    └─ emit tool_result + session_finished on completion
       └─ finally:            // fire-and-forget, NOT awaited by startChat
            ├─ endRun() + publish session_finished
            ├─ maybeRunJournal()       ← journal daily-pass
            ├─ maybeIndexSession()     ← chat-index title/summary
            └─ maybeAppendWikiBacklinks()  ← wiki backlinks sweep
```

The post-processing step (journal / chat-index / wiki-backlinks) runs
in `runAgentInBackground()`'s `finally` block as detached promises —
callers of `startChat()` do **not** await the pipeline, and a failure
in any of those hooks is logged but never propagates up.

The Web UI uses this same entry point — the only difference is how the
caller subscribes to the resulting events (WebSocket in the browser,
in-process pub/sub subscriber for Layer 3's Chat Service API). **Same
agent, same session, same lifecycle hooks.**

This is why adding Telegram doesn't require modifying the agent code: the
agent is downstream of `startChat()`, and `startChat()` doesn't care who
the caller is.

### Layer 5 — Claude CLI + workspace

The actual intelligence and the actual storage. `runAgent()` spawns
`claude` as a subprocess with MCP plugins configured. The workspace
(`~/mulmoclaude/`) is the database — wiki pages, todos, calendar, chat
jsonl, etc. all live as files.

Bridges don't interact with this layer at all. They don't even know it
exists — Layer 3's Chat Service API covers everything.

---

## End-to-end example: "What's the weather today?" via Telegram

Sending a text message from your phone triggers this sequence:

```text
[Phone — Telegram app]
  │  User types "What's the weather today?"
  ▼
[Telegram's server]
  │  Queues the message for the bot account
  ▼
[Layer 2: telegram bridge process]
  │  Poll fires, calls getUpdates
  │  Gets {chatId: 123, text: "What's the weather today?"}
  │  POST http://localhost:3001/api/transports/telegram/chats/123
  │       body: { text: "What's the weather today?" }
  ▼
[Layer 3: Chat Service API]
  │  Loads ~/mulmoclaude/transports/telegram/chats/123.json
  │  → chatSessionId = "telegram-123-1713100000", role = "general"
  │  Text doesn't start with "/" → not a command
  │  Calls startChat({ chatSessionId: "telegram-123-...", message: "...", roleId: "general" })
  │  → returns { kind: "started", chatSessionId } immediately; agent runs in background
  ▼
[Layer 4: startChat]
  │  Appends user message to the session jsonl
  │  Marks session running in session-store (beginRun)
  │  Spawns runAgentInBackground() and returns { kind: "started" }
  ▼
[Layer 5: Claude CLI subprocess]
  │  Receives prompt, decides to call the web_search plugin
  │  Plugin returns search results about today's weather
  │  Claude drafts a reply and emits text chunks
  ▼
[Layer 4: pub/sub]
  │  Each text event (event.message) publishes to the
  │  "session.telegram-123-..." channel; tool_call / tool_call_result
  │  events publish too. A session_finished event fires when the
  │  runAgent generator drains.
  ▼
[Layer 3: Chat Service API]
  │  In-process subscriber concatenates `event.message` chunks into
  │  fullReply = "Sunny with some clouds"
  │  session_finished resolves the pending request promise
  │  Returns HTTP response: { reply: "Sunny with some clouds" }
  │  (journal / chat-index / wiki-backlinks run separately in
  │   runAgentInBackground's finally, not awaited here)
  ▼
[Layer 2: telegram bridge process]
  │  Calls telegramSendMessage(chatId: 123, text: "Sunny…")
  ▼
[Telegram's server]
  │  Delivers to the phone
  ▼
[Phone — Telegram app]
     "Sunny with some clouds"
```

Only the bridge process (Layer 2) and the Chat Service API (Layer 3) are
**new code**. Everything from `startChat()` onwards already exists and is
shared with the Web UI unchanged. The bridge process itself is ~30 lines
of logic — it just shuttles text between Telegram's API and one HTTP
endpoint.

---

## The two-session-ID model

One detail that trips up new contributors: MulmoClaude carries **two**
session IDs, and they live at different layers with different lifetimes.

```text
┌─────────────────────────────────────────────────┐
│ Layer 3 chat-state (~/mulmoclaude/transports/…) │
│   externalChatId: "123"                         │
│   chatSessionId: "telegram-123-…" ──┐            │
│   claudeSessionId: "xyz-789" ──┐  │             │
└──────────────────────────────┼──┼──────────────┘
                               │  │
┌──────────────────────────────┼──▼──────────────┐
│ Layer 4 session-store + jsonl   │               │
│   chatSessionId "telegram-123-…"│               │
│   Persistent — lives as long    │               │
│   as the jsonl file exists.     │               │
│   Shared between the bridge     │               │
│   and the Web UI (same sidebar).│               │
└─────────────────────────────────┼──────────────┘
                                  │
┌─────────────────────────────────▼──────────────┐
│ Layer 5 Claude CLI process                      │
│   claudeSessionId "xyz-789"                     │
│   Volatile — held in the claude CLI's internal  │
│   conversation state. Disappears on CLI restart,│
│   TTL expiry, or crash.                         │
└─────────────────────────────────────────────────┘
```

- **`chatSessionId`** is the MulmoClaude identity of the conversation.
  It owns the jsonl file, appears in the sidebar, and persists forever
  unless explicitly deleted.
- **`claudeSessionId`** is the Claude CLI's identifier for resuming
  its own in-memory conversation state. It's optional — if we pass
  it to `startChat()`, the CLI resumes; if not, it starts a fresh
  conversation context.

When `claudeSessionId` becomes stale (CLI restarted between messages,
process crashed, TTL elapsed), the CLI returns `"No conversation found
with session ID: xyz-789"`. The `chatSessionId` is still intact — we just
need to drop the stale claudeSessionId and let the CLI start a new
conversation. This recovery logic lives in Layer 3's Chat Service API
so every transport benefits automatically.

**Bridges never see either session ID.** They send text and get text
back. The two-ID complexity is entirely contained within Layers 3-5.

---

## Why `startChat()` and not `runAgent()`

PR #106 tried to do the right thing but picked the wrong entry point.
`runAgent()` is an internal function — it just spawns the Claude
subprocess and relays events. All of the following are **outside** of
`runAgent()`:

- Appending the user message to the jsonl
- Registering the session with the in-memory session-store
- Setting the "session running" flag so concurrent requests return 409
- Triggering post-run journal / chat-index / wiki-backlinks updates

These responsibilities live in `startChat()` and `runAgentInBackground()`.
Bypassing them means messages appear to "work" (the bot replies) but:

- The session is **invisible** to the sidebar because session-store
  never heard of it
- Nothing is written to the jsonl, so **refreshing the Web UI loses the
  entire conversation**
- Journal aggregation misses the session — it never appears in the
  daily summary
- Chat-index doesn't generate a title, so sidebar entries are unlabeled
- Wiki-backlinks aren't swept, so links from chat content don't
  propagate

`startChat()` exists specifically because these responsibilities are
non-trivial. **The rule of thumb: any new caller that wants to invoke
the agent must go through `startChat()`.** The Chat Service API is that
caller — and bridges are one step further removed, talking only to the
API.

---

## Why out-of-process bridges, not in-process adapters

The first version of this plan had all bridges running inside the
MulmoClaude server process. The shift to out-of-process happened because:

1. **Failure isolation.** If the Telegram API returns garbage and the
   parsing code throws, only the Telegram bridge crashes. MulmoClaude,
   the Web UI, and every other bridge keep running. The bridge manager
   can restart it automatically.

2. **Independent development.** A bridge can be its own npm package or
   even its own repository. Adding a LINE bridge doesn't require a PR
   to the MulmoClaude core repo. Anyone can write a bridge in any
   language — it just needs to call one HTTP endpoint.

3. **Independent deployment.** Update the Telegram bridge without
   restarting the server. The server never touches platform-specific
   code, so it never needs to change for bridge updates.

4. **Simpler server.** Zero platform imports, zero platform types, zero
   platform error handling in the server. The Chat Service API is a
   handful of routes. The bridge manager is ~50 lines of child-process
   spawning.

5. **User experience is unchanged.** The bridge manager auto-spawns
   bridges based on `.env` variables. The user still just runs
   `yarn dev`. Bridges appear as child processes, and graceful
   shutdown kills them automatically.

The trade-off is the bridge can't call `startChat()` directly — it
goes through HTTP. But `startChat()` is already behind an HTTP endpoint
(`POST /api/agent`) for the Web UI, so this is the same pattern. The
HTTP overhead is negligible compared to the agent execution time.

---

## Summary — what to remember

1. **Bridges are separate processes.** They talk to one HTTP endpoint
   and know nothing about MulmoClaude internals. ~30 lines of logic
   per bridge.
2. **The server owns all state.** Session pointers, roles, commands,
   chat history — all managed by the Chat Service API. Bridges are
   stateless.
3. **Layer 3 (Chat Service API) is where the new server code lives.**
   `chat-state.ts` (session pointer), `commands.ts` (slash commands),
   `index.ts` (HTTP routes). Write once, serves all bridges.
4. **One chat = one active session pointer.** A messaging chat always
   points to exactly one MulmoClaude session. `/reset` creates a new
   session and moves the pointer. `/connect` from the Web UI reassigns
   the pointer to an existing browser session. Old sessions are never
   deleted — they remain in the sidebar.
5. **Layer 4 is untouched.** Bridges invoke the agent via the Chat
   Service API, which calls `startChat()` internally — the same entry
   point the Web UI uses.
6. **Two session IDs, two layers.** `chatSessionId` = persistent, lives in
   Layer 4's jsonl. `claudeSessionId` = volatile, lives in Layer 5's CLI
   process. Recovery when the volatile one dies belongs in Layer 3.
   Bridges never see either ID.
7. **Adding a new platform = writing a bridge.** No server changes.
   The bridge just needs to speak the platform's protocol and POST
   text to `/api/transports/{transportId}/chats/{externalChatId}`.
