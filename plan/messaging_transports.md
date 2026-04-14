# Messaging Transport Layer — Design Document

## 1) Context and Problem

PR #106 proposed a Telegram integration that directly called `runAgent()` in an infinite polling loop. The review identified several issues: no structured logging, a 507-line monolith, no path safety, no graceful shutdown, and tight coupling to Telegram. Meanwhile, users want the same capability for Slack, Twitter/X, and potentially other platforms.

We need a **transport-agnostic messaging layer** — a solid foundation that any messaging platform can plug into without duplicating agent orchestration, session management, or chat persistence logic.

### Current Architecture

The web UI already follows a clean pattern:

1. `POST /api/agent` calls `startChat()` → validates, persists user message, calls `runAgentInBackground()`
2. `runAgentInBackground()` iterates `runAgent()` events, publishes each via `pushSessionEvent()` to pub/sub
3. Client subscribes to `session.{chatSessionId}` on the WebSocket and renders events

The key insight: **`startChat()` is the right entry point**, not `runAgent()`. It handles session metadata, JSONL persistence, session-store registration, and post-processing (journal, chat-index, wiki-backlinks). Calling `runAgent()` directly bypasses all of this.

---

## 2) Design Goals and Non-Goals

### Goals
1. **Transport-agnostic core** — A `MessagingBridge` abstraction that any platform (Telegram, Slack, Twitter/X) can implement
2. **Reuse `startChat()`** — All transports go through the same code path as the web UI
3. **Use the task manager** — Polling loops run as registered tasks with proper lifecycle (start/stop/restart)
4. **Per-transport state** — Each transport manages its own connection state (bot tokens, polling offsets, webhook secrets) independently
5. **Per-chat session mapping** — Map external chat IDs to MulmoClaude sessions, stored in `workspace/transports/{name}/`
6. **Structured logging** — All transports use `server/logger/`

### Non-Goals
1. Rich media bridging (images, files, embeds) — text-only for Phase 0; future phases can extend
2. Two-way tool result rendering in external platforms — visual plugin output stays in the web UI
3. Real-time WebSocket forwarding to external platforms — transports poll pub/sub or use callbacks
4. Admin UI for managing transports — configuration is via `.env` / workspace config files

---

## 3) Architecture

### 3.1 Transport Interface

```ts
// server/transports/types.ts

/** A messaging transport bridges an external platform to MulmoClaude. */
export interface MessagingTransport {
  /** Unique ID, e.g. "telegram", "slack", "twitter" */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /**
   * Called once at server startup. The transport should:
   * - Validate its configuration (env vars, tokens)
   * - Register any needed tasks with the task manager
   * - Return true if enabled, false if not configured
   */
  init(ctx: TransportContext): Promise<boolean>;

  /**
   * Graceful shutdown — stop polling, close connections, clean up.
   */
  shutdown(): Promise<void>;
}

export interface TransportContext {
  /** Task manager for registering polling tasks */
  taskManager: ITaskManager;

  /** Express router for registering webhook endpoints */
  router: express.Router;

  /** Server port for internal API calls (if needed) */
  port: number;
}
```

### 3.2 Chat State (transport-agnostic)

Each transport maps external chat IDs to MulmoClaude sessions. The mapping is stored in the workspace:

```
~/mulmoclaude/transports/
  telegram/
    chats/{chatId}.json    ← per-chat state
  slack/
    chats/{channelId}.json
  twitter/
    chats/{dmId}.json
```

```ts
// server/transports/chat-state.ts

export interface TransportChatState {
  /** External platform's chat/channel/DM ID */
  externalChatId: string;

  /** MulmoClaude session ID */
  sessionId: string;

  /** Active role ID */
  roleId: string;

  /** Claude CLI session ID for conversation resumption */
  claudeSessionId?: string;

  /** ISO timestamps */
  startedAt: string;
  updatedAt: string;

  /** Transport-specific metadata (polling offset, thread ID, etc.) */
  extra?: Record<string, unknown>;
}

/**
 * Read/write chat state for a transport.
 * Uses resolveWithinRoot() for path safety.
 */
export function createChatStateStore(transportId: string): ChatStateStore;
```

The `ChatStateStore` provides:
- `get(externalChatId)` — read state, return null if not found
- `set(state)` — write state
- `reset(externalChatId, roleId?)` — create fresh state, preserving role
- `delete(externalChatId)` — remove state file

### 3.3 Message Relay (transport-agnostic)

The core relay function bridges any transport to `startChat()`:

```ts
// server/transports/relay.ts

export interface RelayMessageParams {
  /** The text message from the external platform */
  message: string;

  /** Transport chat state (contains sessionId, roleId) */
  chatState: TransportChatState;

  /** Called with each text chunk as the agent streams */
  onText?: (chunk: string) => void;

  /** Called when the agent finishes */
  onDone?: (fullReply: string) => void;

  /** Called on error */
  onError?: (error: string) => void;
}

/**
 * Sends a message through startChat() and collects the response.
 *
 * 1. Calls startChat() with the mapped sessionId
 * 2. Subscribes to session events via pub/sub
 * 3. Collects text events into a full reply
 * 4. Updates claudeSessionId in chat state
 * 5. Returns the full text reply
 */
export async function relayMessage(
  params: RelayMessageParams,
): Promise<RelayResult>;

export type RelayResult =
  | { kind: "success"; reply: string; claudeSessionId?: string }
  | { kind: "error"; error: string }
  | { kind: "busy" }; // session already running (409)
```

This replaces the pattern from PR #106 where each transport manually iterated `runAgent()` events. Every transport now gets session persistence, JSONL logging, journal triggers, and chat indexing for free.

### 3.4 Command Handling (transport-agnostic)

Common commands (`/start`, `/help`, `/roles`, `/role <id>`, `/reset`) are shared:

```ts
// server/transports/commands.ts

export interface CommandResult {
  /** Reply text to send back */
  reply: string;

  /** Updated chat state (if changed) */
  nextState?: TransportChatState;
}

/**
 * Parse and execute a slash command.
 * Returns null if the text is not a command.
 */
export function handleCommand(
  text: string,
  chatState: TransportChatState,
): Promise<CommandResult | null>;
```

Transports can add platform-specific commands by wrapping this.

### 3.5 Transport Registry

```ts
// server/transports/index.ts

const transports: MessagingTransport[] = [];

export function registerTransport(transport: MessagingTransport): void;

/**
 * Called from server/index.ts at startup.
 * Initializes all registered transports.
 * Logs which are enabled/disabled.
 */
export async function initTransports(ctx: TransportContext): Promise<void>;

/**
 * Called on graceful server shutdown.
 */
export async function shutdownTransports(): Promise<void>;
```

---

## 4) Telegram Transport (Phase 0 reference implementation)

```ts
// server/transports/telegram/index.ts

export const telegramTransport: MessagingTransport = {
  id: "telegram",
  name: "Telegram",

  async init(ctx) {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    if (!token) return false;

    // Register a polling task with the task manager
    ctx.taskManager.registerTask({
      id: "telegram-poll",
      description: "Poll Telegram for new messages",
      schedule: { type: "interval", intervalMs: 5_000 },
      run: () => pollOnce(token, ctx.port),
    });

    return true;
  },

  async shutdown() {
    // Task manager handles stopping the task
  },
};
```

### Polling via Task Manager

Instead of an infinite `for (;;)` loop, the Telegram transport registers a **5-second interval task**. Each tick calls `getUpdates` with a short timeout (1-2s) and processes any new messages. The task manager handles lifecycle, error logging, and graceful shutdown.

```ts
// server/transports/telegram/poll.ts

let offset = 0;

export async function pollOnce(token: string, port: number): Promise<void> {
  const updates = await telegramApi(token, "getUpdates", {
    timeout: 2,
    offset,
    allowed_updates: ["message"],
  });

  for (const update of updates) {
    offset = update.update_id + 1;
    await handleTelegramUpdate(update, port);
  }
}
```

### Telegram-Specific Files

```
server/transports/telegram/
  index.ts       ← MessagingTransport implementation
  poll.ts        ← pollOnce + offset management
  api.ts         ← telegramApi(), sendMessage(), sendTyping()
  types.ts       ← Telegram API types (TelegramUpdate, TelegramMessage, etc.)
```

### Access Control

The `TELEGRAM_ALLOWED_CHAT_IDS` env var restricts which Telegram chats can interact. This is implemented in `handleTelegramUpdate` — checked before any relay or command processing.

---

## 5) Other Transports (sketched)

### Slack

- **Auth**: `SLACK_BOT_TOKEN` + `SLACK_SIGNING_SECRET`
- **Ingress**: Webhook endpoint (`POST /api/transports/slack/events`) or Socket Mode
- **Mapping**: Slack channel/thread ID -> MulmoClaude session
- **Task**: If using Socket Mode, register a reconnect-on-failure task; if webhooks, no polling needed
- **Constraint**: Slack requires a 3-second ACK for webhook events; long agent runs need a deferred response pattern (ACK immediately, post reply later via `chat.postMessage`)

### Twitter/X

- **Auth**: OAuth 2.0 app credentials + user token
- **Ingress**: Polling DMs via task manager interval, or Account Activity API webhooks
- **Mapping**: DM conversation ID -> MulmoClaude session
- **Constraint**: 280-char limit for public replies — `splitMessage()` with smaller chunk size. DMs allow up to 10,000 chars. Rate limits are strict (app-level + user-level)

### LINE

- **Auth**: `LINE_CHANNEL_ACCESS_TOKEN` + `LINE_CHANNEL_SECRET`
- **Ingress**: Webhook endpoint (`POST /api/transports/line/webhook`). LINE pushes events; no polling needed
- **Mapping**: LINE user ID or group/room ID -> MulmoClaude session
- **Signature verification**: Every webhook request must be verified using HMAC-SHA256 with the channel secret — reject unverified requests
- **Reply vs Push**: LINE distinguishes "reply" (free, must use a `replyToken` within 1 minute of the event) and "push" (costs message quota, can be sent anytime). For agent responses that may take longer than ~30s, use push messages as a fallback
- **Constraint**: 5,000-char limit per text message bubble; max 5 bubbles per reply. Long responses need `splitMessage()` with LINE-specific limits

### WhatsApp (via Cloud API)

- **Auth**: `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_VERIFY_TOKEN` (for webhook verification)
- **Ingress**: Webhook endpoint (`POST /api/transports/whatsapp/webhook`) + GET verification endpoint. Meta sends events via webhook; no polling needed
- **Mapping**: WhatsApp phone number -> MulmoClaude session
- **Webhook verification**: Meta sends a GET with `hub.mode`, `hub.verify_token`, `hub.challenge` — must echo the challenge back if token matches
- **24-hour messaging window**: WhatsApp only allows free-form replies within 24 hours of the user's last message. After that, only pre-approved template messages can be sent. The transport should track the last user message timestamp and warn if the window is closing
- **Constraint**: 4,096-char limit per text message. Must mark incoming messages as "read" via the API to show blue ticks
- **Note**: Requires a Meta Business account and app review for production use; development mode works with up to 5 phone numbers

---

## 6) Integration with Server

### Startup (server/index.ts)

```ts
import { initTransports } from "./transports/index.js";

// After task manager is created and started:
await initTransports({ taskManager, port: PORT });
```

### Shutdown

```ts
import { shutdownTransports } from "./transports/index.js";

process.on("SIGTERM", async () => {
  await shutdownTransports();
  taskManager.stop();
  server.close();
});
```

### Environment

```env
# .env.example additions
# TELEGRAM_BOT_TOKEN=your_token
# TELEGRAM_ALLOWED_CHAT_IDS=123,456
# TELEGRAM_DEFAULT_ROLE_ID=general
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_SIGNING_SECRET=...
# LINE_CHANNEL_ACCESS_TOKEN=...
# LINE_CHANNEL_SECRET=...
# WHATSAPP_PHONE_NUMBER_ID=...
# WHATSAPP_ACCESS_TOKEN=...
# WHATSAPP_VERIFY_TOKEN=my_secret_verify_token
```

---

## 7) File Layout

```
server/transports/
  types.ts              ← MessagingTransport, TransportContext interfaces
  index.ts              ← Registry: registerTransport, initTransports, shutdownTransports
  chat-state.ts         ← ChatStateStore: read/write/reset per-transport chat state
  relay.ts              ← relayMessage(): bridge any transport to startChat()
  commands.ts           ← Shared slash command handler (/start, /help, /roles, etc.)
  telegram/
    index.ts            ← telegramTransport implementation
    poll.ts             ← Long-polling via task manager
    api.ts              ← Telegram Bot API client
    types.ts            ← Telegram-specific types
  slack/                ← (future)
  twitter/              ← (future)
  line/                 ← (future)
  whatsapp/             ← (future)
```

Webhook routes (for platforms that push events):

```
server/routes/transports.ts   ← Express router mounting webhook endpoints
  POST /api/transports/line/webhook
  POST /api/transports/whatsapp/webhook
  GET  /api/transports/whatsapp/webhook   ← Meta verification
  POST /api/transports/slack/events       ← (if using webhooks)
```

Workspace storage:

```
~/mulmoclaude/transports/
  telegram/chats/       ← Per-chat state JSON files
  slack/chats/          ← (future)
  twitter/chats/        ← (future)
  line/chats/           ← (future)
  whatsapp/chats/       ← (future)
```

---

## 8) Implementation Phases

### Phase 0: Foundation + Telegram
1. Create `server/transports/types.ts` — interfaces
2. Create `server/transports/chat-state.ts` — state store with `resolveWithinRoot()`
3. Create `server/transports/relay.ts` — bridge to `startChat()` + pub/sub subscription
4. Create `server/transports/commands.ts` — shared `/start`, `/help`, `/roles`, `/role`, `/reset`
5. Create `server/transports/index.ts` — registry + init/shutdown
6. Create `server/transports/telegram/` — reference implementation using the above
7. Wire into `server/index.ts` — call `initTransports()` after task manager starts
8. Add `.env.example` entries
9. Update `README.md` with Telegram setup section
10. Add unit tests: `test/transports/test_chat-state.ts`, `test/transports/test_commands.ts`, `test/transports/test_relay.ts`

### Phase 1: Slack
1. Create `server/transports/slack/` using the same foundation
2. Add webhook route or Socket Mode support

### Phase 2: LINE
1. Create `server/transports/line/` — webhook-based, no polling
2. Add `POST /api/transports/line/webhook` route with HMAC-SHA256 signature verification
3. Implement reply-token-first strategy with push-message fallback for slow responses

### Phase 3: WhatsApp
1. Create `server/transports/whatsapp/` — webhook-based, no polling
2. Add webhook routes (GET for verification, POST for events)
3. Implement 24-hour window tracking in chat state
4. Handle message read receipts

### Phase 4: Twitter/X
1. Create `server/transports/twitter/` using the same foundation
2. Handle OAuth flow + DM polling

---

## 9) Ingress Patterns: Polling vs Webhook

The five platforms split into two ingress patterns. The `MessagingTransport` interface supports both via `TransportContext`:

| Pattern | Platforms | Mechanism |
|---|---|---|
| **Polling** | Telegram, Twitter/X | Register an interval task via `ctx.taskManager` |
| **Webhook** | LINE, WhatsApp, Slack | Register an Express route via `ctx.router` |

**Polling transports** call the platform API on a timer. The task manager handles scheduling, error logging, and shutdown. Simple, no public URL needed — works behind NAT.

**Webhook transports** receive HTTP pushes from the platform. They register routes under `/api/transports/{name}/` during `init()`. Each platform has its own signature verification (HMAC-SHA256 for LINE, SHA-256 for Slack, Meta's verify-token handshake for WhatsApp) — this is **not** shared, since each scheme differs. Webhooks require the server to be publicly reachable (ngrok for development, reverse proxy for production).

Both patterns converge at `relayMessage()` — once an incoming message is parsed and the transport chat state is loaded, the same relay function handles agent invocation and response collection.

---

## 10) Key Design Decisions

| Decision | Rationale |
|---|---|
| Use `startChat()` not `runAgent()` | Gets session persistence, JSONL, journal, chat-index for free |
| Task manager for polling | Proper lifecycle management, no infinite loops, graceful shutdown |
| Transport-agnostic relay | Telegram, Slack, LINE, WhatsApp, Twitter all use the same relay function |
| Workspace storage for chat state | Consistent with MulmoClaude's "workspace is the database" philosophy |
| `resolveWithinRoot()` for all paths | Prevents path traversal from external chat IDs |
| Shared command handler | `/start`, `/help`, `/roles` work identically across all transports |
| Pub/sub subscription for event collection | Reuses existing infrastructure instead of re-iterating `runAgent()` |
