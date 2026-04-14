# Messaging Transport Architecture — Layer Guide

This is a companion to [`messaging_transports.md`](messaging_transports.md). The
plan doc is terse and assumes you already understand the architecture. This
guide explains the layer structure from the ground up so a newcomer can read
the plan and contribute to it.

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

The messaging transport design introduces a cushion between "talking to an
external messaging platform" and "invoking the agent" so these concerns
live in exactly one place.

---

## The five layers at a glance

```
┌────────────────────────────────────────────────────────────┐
│ Layer 1: External platforms                                    │
│   Telegram / Slack / LINE / WhatsApp / Twitter                 │
│   (services we don't own — we have to speak their protocol)    │
└─────────────┬──────────────────────────────────────────────┘
              │ HTTP APIs / webhooks
┌─────────────▼──────────────────────────────────────────────┐
│ Layer 2: Transport adapters (per-platform)                     │
│   server/transports/telegram/                                  │
│   server/transports/slack/                                     │
│   server/transports/line/ …                                    │
│   Speaks one platform's protocol, and ONLY that protocol.     │
└─────────────┬──────────────────────────────────────────────┘
              │ shared MessagingTransport interface
┌─────────────▼──────────────────────────────────────────────┐
│ Layer 3: Shared relay / chat-state / commands                  │
│   server/transports/relay.ts                                   │
│   server/transports/chat-state.ts                              │
│   server/transports/commands.ts                                │
│   Platform-agnostic glue between Layer 2 and Layer 4.          │
└─────────────┬──────────────────────────────────────────────┘
              │ startChat() — existing public entry point
┌─────────────▼──────────────────────────────────────────────┐
│ Layer 4: MulmoClaude core (already exists, not modified)       │
│   startChat() — session creation, jsonl persistence,           │
│                 background agent launch, post-processing       │
│   runAgent() — Claude CLI subprocess orchestration             │
│   session-store — in-memory sessionId → state                  │
│   pub/sub — session event distribution                         │
└─────────────┬──────────────────────────────────────────────┘
              │ subprocess calls
┌─────────────▼──────────────────────────────────────────────┐
│ Layer 5: Claude CLI + workspace                                │
│   claude (Anthropic Agent SDK CLI)                             │
│   ~/mulmoclaude/ — files are the source of truth               │
└────────────────────────────────────────────────────────────┘
```

Layers 4 and 5 exist today. Layers 2 and 3 are what `messaging_transports.md`
proposes to build.

---

## What each layer does

### Layer 1 — External platforms

These are services we **don't control**. Each has its own:

- Authentication model (bot tokens, OAuth, signing secrets)
- Ingress pattern (polling vs webhooks)
- Message format (text limits, markup flavor, media handling)
- Rate limits and SLA constraints (Slack's 3-second ACK, LINE's 1-minute
  reply-token, WhatsApp's 24-hour window)

Our code **conforms** to each of these — we can't change them. Everything
above this layer is under our control.

### Layer 2 — Transport adapters

Per-platform code. Each directory (`telegram/`, `slack/`, …) contains
everything specific to one platform:

```
server/transports/telegram/
  index.ts   ← MessagingTransport implementation + init()
  poll.ts    ← "Ask Telegram for new messages every 5s" loop, registered
                as a task with the task manager
  api.ts     ← Telegram API wrappers (sendMessage, getUpdates, sendTyping)
  types.ts   ← Telegram-specific response types
```

**Layer 2's two responsibilities, and nothing else:**

1. **Inbound**: parse a platform-specific message → build a normalized
   request → hand it to Layer 3
2. **Outbound**: receive a reply from Layer 3 → format for the platform →
   call the platform's API

**What Layer 2 does NOT know about:**

- `runAgent()` or `startChat()`
- Session IDs, role management, command parsing
- Pub/sub channels
- The workspace filesystem

If a platform's API changes (Telegram adds a new field, LINE deprecates
an endpoint), **only that platform's Layer 2 directory changes**. Every
other layer stays untouched.

### Layer 3 — Shared relay / chat-state / commands

This is where the five-way duplication from the naive design collapses
into one copy. Three sub-concerns:

#### 3a. `chat-state.ts` — who is this conversation?

Every external chat gets mapped to a MulmoClaude session, persisted as a
JSON file per chat:

```json
// ~/mulmoclaude/transports/telegram/chats/123.json
{
  "externalChatId": "123",
  "sessionId": "abc-def",
  "roleId": "general",
  "claudeSessionId": "xyz-789",
  "startedAt": "2026-04-14T12:00:00Z",
  "updatedAt": "2026-04-14T12:30:00Z"
}
```

The state store hides the filesystem details behind a small API:

- `get(externalChatId)` — load or return null
- `set(state)` — persist (atomic write)
- `reset(externalChatId)` — start a fresh session, keep the role
- `delete(externalChatId)` — remove the mapping

Path safety is enforced via `resolveWithinRoot()` (shared with the file
explorer) so a malicious external ID can't escape the transport directory.

#### 3b. `commands.ts` — slash commands

A user typing `/role artist` or `/reset` should behave the same on
Telegram, LINE, Slack, WhatsApp. One implementation, called by all
Layer 2 adapters:

```ts
const result = await handleCommand(text, chatState);
if (result) {
  // command recognized — send result.reply back via Layer 2
  if (result.nextState) await chatStateStore.set(result.nextState);
  return result.reply;
}
// not a command — fall through to relay
```

If a platform needs a unique command (`/slack-thread`, say), it can wrap
or extend this handler without forking it.

#### 3c. `relay.ts` — the bridge to the agent

The single function that non-command text flows through:

```ts
export async function relayMessage({
  message,
  chatState,
  onText,
  onDone,
  onError,
}: RelayMessageParams): Promise<RelayResult> {
  // 1. Invoke Layer 4's public entry point
  const { sessionId } = await startChat({
    sessionId: chatState.sessionId,
    claudeSessionId: chatState.claudeSessionId,
    message,
    roleId: chatState.roleId,
  });

  // 2. Subscribe to session events via pub/sub
  const unsubscribe = subscribeToSession(sessionId, (event) => {
    if (event.type === "text") onText?.(event.chunk);
    if (event.type === "done") finalize();
    if (event.type === "error") onError?.(event.message);
  });

  // 3. Await completion, collecting text into a full reply
  const fullReply = await collectUntilDone();
  unsubscribe();

  // 4. Persist the updated claudeSessionId back to chat-state
  await chatStateStore.set({
    ...chatState,
    claudeSessionId: /* from the agent's last event */,
    updatedAt: new Date().toISOString(),
  });

  return { kind: "success", reply: fullReply };
}
```

**This is the function that PR #106 should have had but didn't.** The
naive `runAgent()` call becomes a `startChat()` call, and pub/sub event
collection takes the place of iterating agent events manually. Every
benefit of `startChat()` (jsonl, session-store, journal triggers,
chat-index) flows through automatically.

### Layer 4 — MulmoClaude core (existing)

We don't touch this layer in the messaging work — we just use it.

`startChat()` is the public entry point:

```
startChat()
  ├─ Validate session / create if new
  ├─ Append user message to jsonl
  ├─ Register in session-store (so the sidebar can see it)
  ├─ Mark session as running
  ├─ Launch runAgentInBackground()
  │    └─ runAgent()
  │         ├─ spawn claude CLI subprocess
  │         ├─ emit text events to pub/sub as tokens stream in
  │         ├─ emit tool_result events when plugins execute
  │         └─ emit done event on completion
  └─ After completion:
      ├─ Trigger journal daily-pass update
      ├─ Trigger chat-index summary
      └─ Trigger wiki-backlinks sweep
```

The Web UI uses this same entry point — the only difference is how the
caller subscribes to the resulting events (WebSocket in the browser,
in-process subscriber for Layer 3 relay). **Same agent, same session, same
lifecycle hooks.**

This is why adding Telegram doesn't require modifying the agent code: the
agent is downstream of `startChat()`, and `startChat()` doesn't care who
the caller is.

### Layer 5 — Claude CLI + workspace

The actual intelligence and the actual storage. `runAgent()` spawns
`claude` as a subprocess with MCP plugins configured. The workspace
(`~/mulmoclaude/`) is the database — wiki pages, todos, calendar, chat
jsonl, etc. all live as files.

Messaging transports don't interact with this layer directly. They don't
need to — Layer 4's `startChat()` covers everything they need to do.

---

## End-to-end example: "What's the weather today?" via Telegram

Sending a text message from your phone triggers this sequence:

```
[Phone — Telegram app]
  │  User types "What's the weather today?"
  ▼
[Telegram's server]
  │  Queues the message for the bot account
  ▼
[Layer 2: telegram/poll.ts]
  │  Polling task fires every 5s, calls getUpdates
  │  Gets {chatId: 123, text: "What's the weather today?"}
  ▼
[Layer 3: chat-state.ts]
  │  Loads ~/mulmoclaude/transports/telegram/chats/123.json
  │  → sessionId = "abc-def", role = "general"
  ▼
[Layer 3: commands.ts]
  │  Text doesn't start with "/" → not a command
  ▼
[Layer 3: relay.ts]
  │  Calls startChat({ sessionId: "abc-def", message: "...", … })
  │  Subscribes to session "abc-def" via pub/sub
  ▼
[Layer 4: startChat]
  │  Appends {type:"text", role:"user", message:"..."} to the session jsonl
  │  Marks session running in session-store
  │  Spawns runAgentInBackground() in the background
  ▼
[Layer 5: Claude CLI subprocess]
  │  Receives prompt, decides to call the web_search plugin
  │  Plugin returns search results about today's weather
  │  Claude drafts a reply and emits text chunks
  ▼
[Layer 4: pub/sub]
  │  Each text chunk publishes to the "session:abc-def" channel
  │  Final done event on completion
  ▼
[Layer 3: relay.ts]
  │  Subscriber collects chunks into fullReply = "Sunny with some clouds"
  │  done event triggers finalize()
  │  Persists updated claudeSessionId back to chat-state
  │  Returns { kind: "success", reply: "Sunny with some clouds" }
  ▼
[Layer 2: telegram/api.ts]
  │  Calls telegramApi.sendMessage(chatId: 123, text: "Sunny…")
  ▼
[Telegram's server]
  │  Delivers to the phone
  ▼
[Phone — Telegram app]
     "Sunny with some clouds"
```

Seventeen steps — but only steps at Layers 2 and 3 are **new code**.
Everything from "startChat" onwards already exists and is shared with
the Web UI unchanged.

---

## The two-session-ID model

One detail that trips up new contributors: MulmoClaude carries **two**
session IDs, and they live at different layers with different lifetimes.

```
┌─────────────────────────────────────────────────┐
│ Layer 3 chat-state (~/mulmoclaude/transports/…) │
│   externalChatId: "123"                         │
│   sessionId: "abc-def"        ──┐                │
│   claudeSessionId: "xyz-789" ──┐ │                │
└───────────────────────────────┼─┼───────────────┘
                                │ │
┌───────────────────────────────▼─┼───────────────┐
│ Layer 4 session-store + jsonl   │                 │
│   sessionId "abc-def"           │                 │
│   Persistent — lives as long    │                 │
│   as the jsonl file exists.     │                 │
│   Shared between Telegram and   │                 │
│   the Web UI (same sidebar).    │                 │
└─────────────────────────────────┼───────────────┘
                                  │
┌─────────────────────────────────▼───────────────┐
│ Layer 5 Claude CLI process                       │
│   claudeSessionId "xyz-789"                      │
│   Volatile — held in the claude CLI's internal   │
│   conversation state. Disappears on CLI restart, │
│   TTL expiry, or crash.                          │
└──────────────────────────────────────────────────┘
```

- **`sessionId`** is the MulmoClaude identity of the conversation. It
  owns the jsonl file, appears in the sidebar, and persists forever
  unless explicitly deleted.
- **`claudeSessionId`** is the Claude CLI's identifier for resuming
  its own in-memory conversation state. It's optional — if we pass
  it to `startChat()`, the CLI resumes; if not, it starts a fresh
  conversation context.

When `claudeSessionId` becomes stale (CLI restarted between messages,
process crashed, TTL elapsed), the CLI returns `"No conversation found
with session ID: xyz-789"`. The `sessionId` is still intact — we just
need to drop the stale claudeSessionId and let the CLI start a new
conversation. This is issue #211 territory, and the fail-over should
live in Layer 3's `relay.ts` so every transport benefits from it
automatically.

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
the agent must go through `startChat()`.** Transports are just one more
kind of caller.

---

## Summary — what to remember

1. **Layers exist so platform code doesn't duplicate agent orchestration.**
   PR #106's mistake was direct `runAgent()` calls, which bypassed all
   the lifecycle hooks that `startChat()` provides.
2. **Layer 2 is per-platform and trivial.** Adding a new platform means
   writing one directory under `server/transports/<name>/` that
   implements `MessagingTransport` and does nothing but talk the
   platform's wire protocol.
3. **Layer 3 is where shared logic lives.** `chat-state.ts` (mapping),
   `commands.ts` (slash commands), `relay.ts` (bridge to `startChat()`).
   Write once, reuse across transports.
4. **Layer 4 is the Web UI's existing entry point.** Messaging
   transports don't modify it — they just call `startChat()` like the
   Web UI does.
5. **Two session IDs, two layers.** `sessionId` = persistent, lives in
   Layer 4's jsonl. `claudeSessionId` = volatile, lives in Layer 5's CLI
   process. Recovery when the volatile one dies belongs in Layer 3.
6. **The Web UI and messaging transports share everything below Layer
   3.** A session started on Telegram appears in the Web UI sidebar
   automatically, because session-store doesn't care who the caller was.
