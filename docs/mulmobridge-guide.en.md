# MulmoBridge Guide — Talk to Your Home PC's AI from Messaging Apps

## What is MulmoBridge?

Your home PC runs an AI agent (Claude, GPT, etc.) that can create documents, manage schedules, organize knowledge in a wiki, and more. But you're not always at your desk.

**MulmoBridge** lets you securely send messages from your phone's **Telegram**, **LINE**, **Slack**, or other messaging apps to the AI agent on your home PC, and get responses back.

```
Your phone                             Your home PC
┌──────────────┐                    ┌─────────────────────┐
│  Telegram     │                   │  MulmoBridge        │
│  LINE         │  ── message ────→ │    ↓                │
│  Slack        │                   │  AI Agent           │
│  Discord      │  ←── reply ─────  │  (Claude, GPT, etc) │
│  ...          │                   │    ↓                │
└──────────────┘                    │  Your files & data  │
                                    └─────────────────────┘
```

You can also send photos and PDFs. The AI can look at images and summarize documents.

---

## Why Separate Packages?

MulmoBridge was originally part of [MulmoClaude](https://github.com/receptron/mulmoclaude), but we extracted it into independent packages because the messaging layer should be usable by everyone — not just MulmoClaude users.

**Benefits of separation:**

1. **Works with any AI tool** — not limited to MulmoClaude. Connect to OpenAI, LangChain, or your own custom agent
2. **Pick only what you need** — want only Telegram? Install just the Telegram package
3. **MIT licensed** — free for any use, including commercial (MulmoClaude itself is AGPL, but the bridge packages are MIT)
4. **Easy to extend** — each package is small and independent, making it simple to add new platforms

---

## Using with MulmoClaude

MulmoClaude is a web-based AI chat app, but with MulmoBridge you can talk to it from anywhere.

### Basic flow

1. **Start MulmoClaude on your home PC** (`yarn dev`)
2. **Start a bridge** — one bridge per messaging platform
3. **Send messages from your phone** — chat with AI using your regular messaging app

### What can you do?

- Ask "What's on my task list today?" from the train
- Send a photo and ask "Summarize this document"
- Request "Prepare materials for tomorrow's meeting"
- Search your wiki: "Where's that trip report from last month?"
- Check or add schedule items

### Try the CLI bridge (easiest)

Talk to AI directly from your terminal. No setup needed.

```bash
# With MulmoClaude running
npx @mulmobridge/cli@latest
```

### Try the Telegram bridge

1. Create a Bot via [@BotFather](https://t.me/BotFather) and get the token
2. Find your Chat ID (use [@userinfobot](https://t.me/userinfobot))
3. Start the bridge:

```bash
TELEGRAM_BOT_TOKEN=your-bot-token \
TELEGRAM_ALLOWED_CHAT_IDS=your-chat-id \
  npx @mulmobridge/telegram@latest
```

Detailed setup: [Telegram README](https://github.com/receptron/mulmoclaude/blob/main/packages/telegram/README.md)

---

## Supported Platforms

| Platform | Package | Status | Setup guide |
|---|---|---|---|
| **Terminal (CLI)** | [@mulmobridge/cli](https://www.npmjs.com/package/@mulmobridge/cli) | Stable | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/cli/README.md) |
| **Telegram** | [@mulmobridge/telegram](https://www.npmjs.com/package/@mulmobridge/telegram) | Stable | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/telegram/README.md) |
| **Discord** | [@mulmobridge/discord](https://www.npmjs.com/package/@mulmobridge/discord) | Experimental | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/discord/README.md) |
| **Slack** | [@mulmobridge/slack](https://www.npmjs.com/package/@mulmobridge/slack) | Experimental | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/slack/README.md) |
| **LINE** | [@mulmobridge/line](https://www.npmjs.com/package/@mulmobridge/line) | Verified | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/line/README.md) |
| **WhatsApp** | [@mulmobridge/whatsapp](https://www.npmjs.com/package/@mulmobridge/whatsapp) | Experimental | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/whatsapp/README.md) |
| **Matrix** | [@mulmobridge/matrix](https://www.npmjs.com/package/@mulmobridge/matrix) | Experimental | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/matrix/README.md) |
| **IRC** | [@mulmobridge/irc](https://www.npmjs.com/package/@mulmobridge/irc) | Experimental | [README](https://github.com/receptron/mulmoclaude/blob/main/packages/irc/README.md) |

> **"Experimental" means** testing is limited and bugs are likely. Your feedback is very welcome!

---

## Try It with the Mock Server

You don't need MulmoClaude installed to test bridges. The **mock server** echoes your messages back — a quick way to verify everything works.

### Step 1: Start the mock server

```bash
npx @mulmobridge/mock-server@latest
```

It will display a connection token (default: `mock-test-token`).

### Step 2: Connect a bridge

Open another terminal:

```bash
# CLI bridge (easiest)
MULMOCLAUDE_AUTH_TOKEN=mock-test-token npx @mulmobridge/cli@latest

# Telegram bridge
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
TELEGRAM_BOT_TOKEN=your-bot-token \
TELEGRAM_ALLOWED_CHAT_IDS=your-chat-id \
  npx @mulmobridge/telegram@latest
```

Send a message and you'll get `[echo] your message` back. Try slash commands too: `/help`, `/roles`, `/status`.

Mock server details: [mock-server README](https://github.com/receptron/mulmoclaude/blob/main/packages/mock-server/README.md)

---

## For Developers: Use MulmoBridge in Your Own Tool

MulmoBridge is not MulmoClaude-specific. You can integrate it into any AI application.

### Architecture

```
Messaging app  ←→  Bridge  ←→  chat-service  ←→  Your AI agent
  (Telegram)      (@mulmobridge/   (@mulmobridge/     (anything)
                    telegram)        chat-service)
```

### Minimal integration

```typescript
import express from "express";
import { createServer } from "http";
import { createChatService } from "@mulmobridge/chat-service";

const app = express();
const server = createServer(app);

const chatService = createChatService({
  startChat: async ({ text }) => {
    const reply = await myAgent.run(text);
    return { reply };
  },
  // See chat-service README for full deps interface
  onSessionEvent: () => {},
  loadAllRoles: async () => [{ id: "default", name: "Assistant" }],
  getRole: async () => ({ id: "default", name: "Assistant" }),
  defaultRoleId: "default",
  transportsDir: "/tmp/transports",
  logger: console,
});

app.use(chatService.router);
chatService.attachSocket(server);
server.listen(3001);
// → Now any bridge (Telegram, Slack, CLI) can connect!
```

### Writing a new bridge

Bridges are ~100 lines. See the [Bridge Protocol](bridge-protocol.md) for the wire spec. Any language with a socket.io 4.x client works (Python, Go, etc.).

---

## All Packages

### Messaging (@mulmobridge scope)

| Package | Description | npm | Source |
|---|---|---|---|
| [@mulmobridge/protocol](https://www.npmjs.com/package/@mulmobridge/protocol) | Protocol types & constants | [npm](https://www.npmjs.com/package/@mulmobridge/protocol) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/protocol) |
| [@mulmobridge/chat-service](https://www.npmjs.com/package/@mulmobridge/chat-service) | Server-side chat service | [npm](https://www.npmjs.com/package/@mulmobridge/chat-service) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/chat-service) |
| [@mulmobridge/client](https://www.npmjs.com/package/@mulmobridge/client) | Bridge-side client library | [npm](https://www.npmjs.com/package/@mulmobridge/client) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/client) |
| [@mulmobridge/mock-server](https://www.npmjs.com/package/@mulmobridge/mock-server) | Mock server for testing | [npm](https://www.npmjs.com/package/@mulmobridge/mock-server) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/mock-server) |
| [@mulmobridge/cli](https://www.npmjs.com/package/@mulmobridge/cli) | CLI bridge | [npm](https://www.npmjs.com/package/@mulmobridge/cli) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/cli) |
| [@mulmobridge/telegram](https://www.npmjs.com/package/@mulmobridge/telegram) | Telegram bridge | [npm](https://www.npmjs.com/package/@mulmobridge/telegram) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/telegram) |
| [@mulmobridge/discord](https://www.npmjs.com/package/@mulmobridge/discord) | Discord bridge | [npm](https://www.npmjs.com/package/@mulmobridge/discord) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/discord) |
| [@mulmobridge/slack](https://www.npmjs.com/package/@mulmobridge/slack) | Slack bridge | [npm](https://www.npmjs.com/package/@mulmobridge/slack) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/slack) |
| [@mulmobridge/line](https://www.npmjs.com/package/@mulmobridge/line) | LINE bridge | [npm](https://www.npmjs.com/package/@mulmobridge/line) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/line) |
| [@mulmobridge/whatsapp](https://www.npmjs.com/package/@mulmobridge/whatsapp) | WhatsApp bridge | [npm](https://www.npmjs.com/package/@mulmobridge/whatsapp) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/whatsapp) |
| [@mulmobridge/matrix](https://www.npmjs.com/package/@mulmobridge/matrix) | Matrix bridge | [npm](https://www.npmjs.com/package/@mulmobridge/matrix) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/matrix) |
| [@mulmobridge/irc](https://www.npmjs.com/package/@mulmobridge/irc) | IRC bridge | [npm](https://www.npmjs.com/package/@mulmobridge/irc) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/irc) |

### General tools (@receptron scope)

| Package | Description | npm | Source |
|---|---|---|---|
| [@receptron/task-scheduler](https://www.npmjs.com/package/@receptron/task-scheduler) | Persistent task scheduler | [npm](https://www.npmjs.com/package/@receptron/task-scheduler) | [source](https://github.com/receptron/mulmoclaude/tree/main/packages/scheduler) |

---

## We Want Your Feedback!

The newer bridges (Discord, Slack, LINE, WhatsApp, Matrix, IRC) haven't been thoroughly tested yet.

- **Tried it?** Please tell us at [Issues](https://github.com/receptron/mulmoclaude/issues/new) — both "it worked" and "it broke" reports help
- **Found a bug?** Include the `--verbose` log from the mock server
- **Want a new platform?** Open an issue. Bridges are ~100 lines, so PRs are welcome too

GitHub: https://github.com/receptron/mulmoclaude
npm: https://www.npmjs.com/org/mulmobridge
