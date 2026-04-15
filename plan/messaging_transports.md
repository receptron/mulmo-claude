# Messaging Transport Layer — Design Document

## 1) User Experience — Remote Access to MulmoClaude

### The Problem We're Solving

MulmoClaude today is a **localhost-only** app. You must be sitting in front of the machine running the server to use it. But the most valuable use cases happen when you're **away from your desk** — commuting, in a meeting, on your phone, or simply on a different device.

The messaging transport layer turns MulmoClaude into a **remote-accessible personal assistant**. You message it from the apps you already have open — Telegram, LINE, WhatsApp, Slack, Twitter/X — and it responds using the same Claude agent, the same workspace, the same roles and plugins.

### What the User Can Do

**Chat from anywhere.** Send a message from your phone's Telegram/LINE/WhatsApp. MulmoClaude receives it, runs the agent, and sends the text reply back to the same chat. No browser, no VPN, no port forwarding needed — the messaging platform handles the connectivity.

**Use the same workspace.** Everything the agent does — file edits, wiki updates, todo changes, calendar entries — happens in the same `~/mulmoclaude/` workspace. When you get back to your desk and open the web UI, all the work is there. Chat history from messaging sessions appears in the sidebar alongside browser sessions.

**Switch roles on the fly.** Type `/role artist` in Telegram to switch to the artist persona, or `/roles` to see what's available. The role system works identically across all platforms.

**Maintain conversation context.** The agent remembers your conversation within a session. Send follow-up messages and it picks up where you left off — same as the web UI. Type `/reset` to start a fresh session.

**Control access.** Restrict which Telegram chats, LINE users, or WhatsApp numbers can talk to your bot. This is your personal assistant running on your machine — access control is essential.

### Session Model — Bridging Messaging and Web UI

MulmoClaude's web UI supports multiple sessions (visible in the sidebar), but a messaging app is a single continuous thread. The session model resolves this tension with a simple rule: **each messaging chat has exactly one "active session pointer"** managed by the server, and both sides can change what it points to.

**How it works:**

1. **First message from Telegram** → server creates a new session `telegram-{chatId}-{timestamp}`. This becomes the active session for that chat.
2. **Subsequent messages** → continue the same active session. The agent has full conversation context.
3. **View from Web UI** → the messaging session appears in the sidebar like any other session. The user can open it, read the history, and continue the conversation from the browser.
4. **`/reset` in the messaging app** → server creates a fresh session `telegram-{chatId}-{newTimestamp}` and makes it the new active session. The old session remains in the sidebar (not deleted).
5. **`/connect telegram` in the Web UI** → takes the currently-open browser session and makes it the active session for the Telegram chat. This is how you "hand off" a browser conversation to your phone.

**Key properties:**
- Sessions are normal MulmoClaude sessions — accessible from both the messaging app and the web UI at all times
- The active session pointer lives on the server — bridges never see session IDs
- Old sessions are never deleted by pointer changes — they stay in the sidebar for reference
- The session naming convention (`telegram-xxx`, `line-xxx`) makes the origin visible in the sidebar

### What Stays in the Web UI

Rich visual output — plugin views (spreadsheets, charts, images, wiki pages, stories), drag-and-drop, canvas layout — stays in the browser. Messaging transports are **text-first**. The agent still generates visual artifacts, but they're accessed through the web UI. The messaging reply tells you what was done; the web UI shows you the result.

### Example Scenarios

- **On the train**: "Add a todo: review the Q3 budget proposal by Friday" → agent creates the todo, confirms via LINE
- **In a meeting**: "Summarize my wiki page on project-alpha" → agent reads the wiki, sends a summary to WhatsApp
- **Quick check from phone**: "What's on my calendar today?" → agent reads calendar files, replies in Telegram
- **Creative work**: "Write a haiku about spring rain" → agent responds in the chat; if you asked the storyteller role, the MulmoScript is saved to workspace for later viewing in the web UI
- **Hand off to phone**: Start a conversation in the browser, then type `/connect telegram` to attach it to your Telegram chat. Continue the same conversation from your phone on the go.
- **Hand off to PC**: Start a conversation on Telegram during lunch. When back at your desk, select the `telegram-xxx` session from the sidebar and continue in the web UI with full visual output.

---

## 2) Context and Problem

PR #106 proposed a Telegram integration that directly called `runAgent()` in an infinite polling loop inside the server process. The review identified several issues: no structured logging, a 507-line monolith, no path safety, no graceful shutdown, and tight coupling to Telegram.

Meanwhile, users want the same capability for Slack, Twitter/X, LINE, and WhatsApp. Building all of these as in-process adapters would couple every platform's code, dependencies, and failure modes to the MulmoClaude server.

### Key Insight — The Web UI Is Already a "Bridge"

The web UI already communicates with MulmoClaude via HTTP (`POST /api/agent`) and WebSocket (pub/sub). It doesn't call `startChat()` directly — it calls the REST API. A Telegram bridge can do exactly the same thing. The server doesn't need to know about Telegram at all — it just needs to expose a clean Chat Service API, and external processes handle the platform-specific protocol.

---

## 3) Design Goals and Non-Goals

### Goals
1. **Out-of-process bridges** — Each platform adapter runs as a separate process, communicating with MulmoClaude only via the Chat Service API
2. **Bridges are stateless** — All session state (active session pointer, role, chat history) lives on the server. Bridges are dumb pipes
3. **Server owns all business logic** — Session creation, role switching, `/reset`, command parsing — all handled by the server. Bridges forward raw text
4. **Child process management** — MulmoClaude auto-spawns bridge processes based on `.env` config, so the user just runs `yarn dev`
5. **Zero platform code in the server** — No `server/transports/telegram/`. The server exposes an API; bridges consume it
6. **Independent development** — A bridge can be its own npm package, even its own repo. Adding a new bridge requires zero server changes

### Non-Goals
1. Rich media bridging (images, files, embeds) — text-only for Phase 0; future phases can extend
2. Two-way tool result rendering in external platforms — visual plugin output stays in the web UI
3. Admin UI for managing bridges — configuration is via `.env`
4. Bridge-side state — bridges must not cache session IDs, roles, or conversation state

---

## 4) Architecture

### Overview

```
MulmoClaude server (single process)
  ├─ Express (existing Web UI API)
  ├─ Chat Service API (new — thin layer over startChat + chat-state)
  ├─ Chat state store (server-side, per transport)
  │
  ├─ child process: telegram-bridge
  ├─ child process: line-bridge
  ├─ child process: slack-bridge
  └─ ...
```

The bridges are **completely separate processes**. They share no memory, no imports, no types with the server. They communicate exclusively via HTTP.

### 4.1 Chat Service API (server-side)

The API that bridges call. Two endpoints handle the core flow:

```
POST /api/chat/:transportId/:externalChatId
  Body: { text: string }
  Response: { reply: string }

  The server:
  1. Looks up the active session for this transport+chatId
  2. If none exists, creates a new session (e.g. "telegram-123-1713100000")
  3. Checks if text is a command (/reset, /role, /roles, /help, /status)
     - If command: executes it, returns the result as reply
  4. If not a command: calls startChat() with the active session
  5. Subscribes to pub/sub, collects text events
  6. Returns the full agent reply as response
```

```
POST /api/chat/:transportId/connect
  Body: { chatSessionId: string }
  Response: { ok: true }

  Reassigns the active session pointer for a transport.
  Called from the Web UI's "Connect to Telegram" action.
```

```
GET /api/chat/transports
  Response: { transports: [{ id: "telegram", enabled: true }, ...] }

  Lists registered transports and their status.
  Used by the Web UI to show "Connect to..." options.
```

**What the bridge sees:** Send text, get reply. That's it. The bridge never sees session IDs, role IDs, or any internal state.

### 4.2 Chat State (server-side)

The server manages all chat state. One JSON file per external chat, stored in the workspace:

```
~/mulmoclaude/transports/
  telegram/
    chats/{chatId}.json
  line/
    chats/{userId}.json
  slack/
    chats/{channelId}.json
```

```ts
// server/chat-service/chat-state.ts

export interface TransportChatState {
  /** External platform's chat/channel/DM ID */
  externalChatId: string;

  /** Active MulmoClaude session ID */
  sessionId: string;

  /** Active role ID */
  roleId: string;

  /** Claude CLI session ID for conversation resumption */
  claudeSessionId?: string;

  /** ISO timestamps */
  startedAt: string;
  updatedAt: string;
}
```

Operations:
- `get(transportId, externalChatId)` — read state, return null if not found
- `set(transportId, state)` — write state
- `reset(transportId, externalChatId, roleId?)` — create a fresh session, move the pointer. Old session stays in sidebar
- `connect(transportId, chatSessionId)` — point this transport at an existing session
- Path safety via `resolveWithinRoot()` for all file operations

**Session ID format**: `{transportId}-{externalChatId}-{timestamp}` (e.g. `telegram-123-1713100000`).

### 4.3 Command Handling (server-side)

The server parses and executes commands before they reach the agent. The bridge sends raw text; if it starts with `/`, the server handles it directly.

| Command | Action |
|---|---|
| `/reset` | Create a fresh session, make it active |
| `/help` | Return list of available commands |
| `/roles` | Return list of available roles |
| `/role <id>` | Switch role and create a new session |
| `/status` | Return current role and last activity |

Since command handling is server-side, every platform gets the same behavior with zero bridge code.

### 4.4 Bridge Process Management

MulmoClaude spawns bridges as child processes at startup based on `.env` configuration:

```ts
// server/bridge-manager.ts

export interface BridgeConfig {
  /** Transport ID (e.g. "telegram") */
  id: string;

  /** Path to the bridge executable or script */
  command: string;

  /** Env var that enables this bridge (checked for non-empty value) */
  enableEnvVar: string;

  /** Extra env vars to pass to the bridge process */
  envVars: string[];
}

const BRIDGE_CONFIGS: BridgeConfig[] = [
  {
    id: "telegram",
    command: "node ./bridges/telegram/index.js",
    enableEnvVar: "TELEGRAM_BOT_TOKEN",
    envVars: ["TELEGRAM_BOT_TOKEN", "TELEGRAM_ALLOWED_CHAT_IDS"],
  },
  {
    id: "line",
    command: "node ./bridges/line/index.js",
    enableEnvVar: "LINE_CHANNEL_ACCESS_TOKEN",
    envVars: ["LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET"],
  },
  // ...
];
```

At startup:

```ts
// server/index.ts
import { startBridges, stopBridges } from "./bridge-manager.js";

app.listen(PORT, "0.0.0.0", () => {
  startBridges(PORT);  // checks env vars, spawns enabled bridges
});

process.on("SIGTERM", async () => {
  await stopBridges();  // sends SIGTERM to children, waits for exit
  server.close();
});
```

Each child process receives:
- `MULMOCLAUDE_API_URL=http://localhost:{PORT}` — the Chat Service API URL
- `MULMOCLAUDE_TRANSPORT_ID=telegram` — its transport identity
- Platform-specific env vars (bot tokens, secrets)

If a child process crashes, the bridge manager logs the error and optionally restarts it (configurable).

### 4.5 CLI Bridge — The Reference Implementation

The simplest possible bridge: reads from stdin, posts to the Chat Service API, prints the reply. No API keys, no platform dependencies, no network setup. It validates the entire Chat Service API end-to-end.

```ts
// bridges/cli/index.ts

import * as readline from "readline";

const API_URL = process.env.MULMOCLAUDE_API_URL ?? "http://localhost:3001";
const TRANSPORT_ID = "cli";
const CHAT_ID = "terminal";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt() {
  rl.question("You: ", async (text) => {
    if (!text.trim()) return prompt();

    const res = await fetch(`${API_URL}/api/chat/${TRANSPORT_ID}/${CHAT_ID}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.trim() }),
    });
    const { reply } = await res.json();

    console.log(`\nAssistant: ${reply}\n`);
    prompt();
  });
}

console.log("MulmoClaude CLI bridge. Type /help for commands, Ctrl+C to exit.\n");
prompt();
```

That's the entire bridge. ~20 lines of logic. It exercises every server-side feature — session creation, command handling, agent invocation, response collection — without any platform complexity. Run it with:

```bash
node ./bridges/cli/index.js
```

Start the server in one terminal (`yarn dev`), then run the CLI bridge in another (`yarn cli`).

### 4.6 What a Platform Bridge Looks Like

Platform bridges follow the same pattern with platform-specific I/O. Here's Telegram:

```ts
// bridges/telegram/index.ts

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

    const res = await fetch(`${API_URL}/api/chat/${TRANSPORT_ID}/${chatId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const { reply } = await res.json();

    await telegramSendMessage(BOT_TOKEN, chatId, reply);
  }
}

setInterval(poll, 5000);
```

~30 lines of logic. The only difference from the CLI bridge is the I/O: poll Telegram instead of readline, sendMessage instead of console.log. The server interaction is identical — one POST, one reply. Access control (`TELEGRAM_ALLOWED_CHAT_IDS`) lives in the bridge to avoid unnecessary API calls.

---

## 5) Platform-Specific Bridge Notes

### CLI (reference implementation)

- **Ingress**: stdin (readline)
- **Bridge complexity**: Trivial — ~20 lines, zero dependencies
- **Purpose**: Validates the Chat Service API without any platform setup. Also useful as a template for new bridges
- **Chat ID**: Fixed to `"terminal"` — single session, single user
- **Not auto-spawned** — run manually via `yarn cli` in a second terminal. Not managed by the bridge manager since it's an interactive tool, not a daemon

### Telegram

- **Ingress**: Long polling (`getUpdates`)
- **Bridge complexity**: Minimal — poll loop + send message
- **Access control**: `TELEGRAM_ALLOWED_CHAT_IDS` env var, checked in bridge before API call
- **No public URL needed** — polling works behind NAT

### LINE

- **Ingress**: Webhook — LINE pushes events to the bridge
- **Bridge complexity**: Low — HTTP server + HMAC-SHA256 signature verification
- **The bridge runs its own HTTP server** (e.g. port 3002) to receive LINE webhooks. MulmoClaude's bridge manager spawns it; LINE's webhook URL points to it (via ngrok or reverse proxy)
- **Reply vs Push**: LINE's `replyToken` expires in 1 minute. If the agent takes longer, the bridge falls back to push messages

### WhatsApp (Cloud API)

- **Ingress**: Webhook — Meta pushes events to the bridge
- **Bridge complexity**: Low-medium — HTTP server + Meta's webhook verification handshake
- **24-hour window**: The bridge should track when the last user message arrived. If >24h, only template messages are allowed. Simplest approach: just let the API call fail and return the error to the user
- **Read receipts**: Bridge marks messages as "read" on receipt

### Slack

- **Ingress**: Socket Mode (preferred, no public URL) or webhook
- **Bridge complexity**: Medium — Slack's event format is more complex, and the 3-second ACK requirement means the bridge must ACK immediately and post the reply later via `chat.postMessage`
- **Thread mapping**: Slack threads map naturally to sessions

### Twitter/X

- **Ingress**: Polling DMs via API
- **Bridge complexity**: Medium — OAuth 2.0 flow, strict rate limits
- **DM character limit**: 10,000 chars (not the 280-char public tweet limit)

---

## 6) Webhook Bridges and Ingress

Some platforms (LINE, WhatsApp, Slack in webhook mode) push events to an HTTP endpoint. These bridges run their own small HTTP server:

```
Internet
  │
  ├─ LINE webhook ──────► line-bridge (port 3002) ──► MulmoClaude API (port 3001)
  ├─ WhatsApp webhook ──► whatsapp-bridge (port 3003) ──► MulmoClaude API (port 3001)
  │
  └─ Telegram polling ◄── telegram-bridge ──────────► MulmoClaude API (port 3001)
```

- Polling bridges (Telegram, Twitter/X) only need outbound HTTP — works behind NAT
- Webhook bridges need a public URL for the platform to push to — use ngrok for development, reverse proxy for production
- Each webhook bridge listens on its own port, configured via env var (e.g. `LINE_BRIDGE_PORT=3002`)
- The bridge manager passes these port assignments as env vars

---

## 7) Integration with Server

### Server-Side Files

```
server/
  chat-service/
    index.ts            ← Chat Service API routes
    chat-state.ts       ← Per-transport chat state store
    commands.ts         ← Server-side command handler
  bridge-manager.ts     ← Child process lifecycle (spawn, restart, shutdown)
```

No `server/transports/` directory. No platform-specific code in the server at all.

### Bridge Files (separate from server)

```
bridges/
  cli/
    index.ts            ← Reference implementation: readline → API → console
  telegram/
    index.ts            ← Poll loop + Telegram API calls
    api.ts              ← Telegram Bot API wrappers
  line/
    index.ts            ← Webhook HTTP server + LINE API calls
    api.ts              ← LINE Messaging API wrappers
  slack/
    index.ts            ← Socket Mode or webhook + Slack API calls
  whatsapp/
    index.ts            ← Webhook HTTP server + WhatsApp Cloud API calls
  twitter/
    index.ts            ← DM polling + Twitter API calls
```

### Workspace Storage

```
~/mulmoclaude/transports/
  telegram/chats/       ← Per-chat state JSON files (managed by server)
  line/chats/
  slack/chats/
  whatsapp/chats/
  twitter/chats/
```

### Environment

```env
# .env — bridges are auto-spawned when their token env var is present

# Telegram (polling — no public URL needed)
# TELEGRAM_BOT_TOKEN=your_token
# TELEGRAM_ALLOWED_CHAT_IDS=123,456

# LINE (webhook — needs public URL)
# LINE_CHANNEL_ACCESS_TOKEN=...
# LINE_CHANNEL_SECRET=...
# LINE_BRIDGE_PORT=3002

# WhatsApp (webhook — needs public URL)
# WHATSAPP_PHONE_NUMBER_ID=...
# WHATSAPP_ACCESS_TOKEN=...
# WHATSAPP_VERIFY_TOKEN=my_secret
# WHATSAPP_BRIDGE_PORT=3003

# Slack (Socket Mode preferred — no public URL needed)
# SLACK_BOT_TOKEN=xoxb-...
# SLACK_APP_TOKEN=xapp-...

# Twitter/X (polling — no public URL needed)
# TWITTER_API_KEY=...
# TWITTER_API_SECRET=...
# TWITTER_ACCESS_TOKEN=...
# TWITTER_ACCESS_SECRET=...
```

---

## 8) Implementation Phases

### Phase 0: Chat Service API + CLI Bridge
1. Create `server/chat-service/chat-state.ts` — state store with `resolveWithinRoot()`
2. Create `server/chat-service/commands.ts` — server-side `/reset`, `/help`, `/roles`, `/role`, `/status`
3. Create `server/chat-service/index.ts` — `POST /api/chat/:transportId/:externalChatId`, `POST /api/chat/:transportId/connect`, `GET /api/chat/transports`
4. Create `bridges/cli/index.ts` — reference implementation (~20 lines)
5. Wire into `server/index.ts` — mount chat-service routes
6. Unit tests: `test/chat-service/test_chat-state.ts`, `test/chat-service/test_commands.ts`
7. Manual end-to-end test: run server, run CLI bridge, verify conversation round-trip, verify session appears in Web UI sidebar, verify `/reset` and `/role` commands

### Phase 1: Bridge Manager + Telegram Bridge
1. Create `server/bridge-manager.ts` — child process spawning based on env vars, restart on crash, graceful shutdown
2. Create `bridges/telegram/` — polling bridge (~30 lines of logic)
3. Wire bridge manager into `server/index.ts` — call `startBridges()` after server listen
4. Add `.env.example` entries
5. Update `README.md` with setup instructions

### Phase 1.5: Web UI Connect Support
1. Add "Connect to {transport}" action in session header/context menu (calls `POST /api/chat/:transportId/connect`)
2. Show transport badge on sidebar sessions whose IDs start with a transport prefix
3. Use `GET /api/chat/transports` to determine which transports are available

### Phase 2: LINE Bridge
1. Create `bridges/line/` — webhook HTTP server + LINE API
2. Add `LINE_*` env vars to bridge manager config
3. Document ngrok setup for development

### Phase 3: Slack Bridge
1. Create `bridges/slack/` — Socket Mode (no public URL needed)
2. Handle Slack's deferred response pattern (ACK immediately, reply later)

### Phase 4: WhatsApp Bridge
1. Create `bridges/whatsapp/` — webhook HTTP server + Meta Cloud API
2. Handle webhook verification handshake
3. Document Meta Business account setup

### Phase 5: Twitter/X Bridge
1. Create `bridges/twitter/` — DM polling + Twitter API
2. Handle OAuth flow

---

## 9) Key Design Decisions

| Decision | Rationale |
|---|---|
| Out-of-process bridges | True failure isolation, independent versioning, zero platform code in server |
| Server owns all state | Bridges are stateless dumb pipes — simplest possible bridge, no state sync issues |
| Bridges don't see session IDs | Maximum decoupling — server handles all session logic internally |
| CLI bridge as reference implementation | Validates the entire API with zero platform dependencies; also serves as a template for new bridges |
| Chat Service API over HTTP | Bridges are just HTTP clients — language-agnostic, testable with curl |
| Child process spawning | User still just runs `yarn dev` — bridge lifecycle is managed automatically |
| 1 chat = 1 active session pointer | Messaging apps have one thread; the pointer resolves the multi-session mismatch cleanly |
| `/reset` creates, `/connect` reassigns | Both sides can change what the pointer targets; old sessions are never lost |
| Sessions are normal MulmoClaude sessions | No special "transport session" type — accessible from both messaging and Web UI |
| Session ID encodes origin (`telegram-xxx`) | Visible in sidebar, easy to filter, no metadata lookup needed |
| Commands parsed server-side | Every platform gets identical command behavior with zero bridge code |
| `startChat()` as the internal entry point | Gets session persistence, JSONL, journal, chat-index for free |
| Workspace storage for chat state | Consistent with MulmoClaude's "workspace is the database" philosophy |
| `resolveWithinRoot()` for all paths | Prevents path traversal from external chat IDs |
