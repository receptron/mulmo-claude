# MulmoBridge — Securely Connect Messaging Apps to Your Personal Computer

MulmoBridge lets you talk to **the AI agent running on your home PC** from **Telegram, LINE, Slack, or any messaging app** — securely, over the internet.

Your personal computer is becoming your most powerful AI assistant. It runs local agents (Claude Code, OpenAI, LangChain, etc.), has access to your files, your calendar, your code. But you're not always at your desk. MulmoBridge is the secure pipe that connects your phone's messaging apps to that agent on your PC, so you can ask it questions, give it tasks, and get results — from anywhere.

**MulmoBridge is not tied to MulmoClaude.** It was extracted from MulmoClaude as an independent, MIT-licensed protocol. We want every AI tool builder to use it — the more agents and messaging platforms speak MulmoBridge, the more useful the ecosystem becomes for everyone.

## How It Works

```text
 You, on your phone                     Your PC at home
┌─────────────────┐                    ┌──────────────────────────┐
│  Telegram        │                   │  MulmoBridge chat-service │
│  LINE            │  ── socket.io ──► │         ↓                 │
│  Slack           │     (secure)      │  Your AI Agent            │
│  Discord         │  ◄── replies ──── │  (Claude, GPT, custom)    │
│  ...             │                   │         ↓                 │
└─────────────────┘                    │  Your files, tools, data  │
                                       └──────────────────────────┘

```

A **bridge** is a tiny process (~100 lines) that translates between a messaging platform's API and the MulmoBridge socket.io protocol. The `@mulmobridge/client` library handles all the socket.io boilerplate — writing a new bridge is just writing the platform adapter.

## Packages

### Core

| Package | Description | npm |
|---|---|---|
| [@mulmobridge/protocol](./protocol/) | Wire protocol types and constants | [![npm](https://img.shields.io/npm/v/@mulmobridge/protocol)](https://www.npmjs.com/package/@mulmobridge/protocol) |
| [@mulmobridge/chat-service](./chat-service/) | Server-side chat service (Express + socket.io, DI-pure) | [![npm](https://img.shields.io/npm/v/@mulmobridge/chat-service)](https://www.npmjs.com/package/@mulmobridge/chat-service) |
| [@mulmobridge/client](./client/) | Bridge-side socket.io client library | [![npm](https://img.shields.io/npm/v/@mulmobridge/client)](https://www.npmjs.com/package/@mulmobridge/client) |
| [@mulmobridge/mock-server](./mock-server/) | Lightweight mock server for testing | [![npm](https://img.shields.io/npm/v/@mulmobridge/mock-server)](https://www.npmjs.com/package/@mulmobridge/mock-server) |

### Bridges

| Package | Description | How it receives messages | Public URL needed? | npm |
|---|---|---|---|---|
| [@mulmobridge/cli](./cli/) | Terminal bridge | stdin | No | [![npm](https://img.shields.io/npm/v/@mulmobridge/cli)](https://www.npmjs.com/package/@mulmobridge/cli) |
| [@mulmobridge/telegram](./telegram/) | Telegram bot (photo support, allowlist) | Long polling (outbound HTTP) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/telegram)](https://www.npmjs.com/package/@mulmobridge/telegram) |
| [@mulmobridge/slack](./slack/) | Slack bot (Socket Mode) | WebSocket to Slack (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/slack)](https://www.npmjs.com/package/@mulmobridge/slack) |
| [@mulmobridge/discord](./discord/) | Discord bot | WebSocket Gateway (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/discord)](https://www.npmjs.com/package/@mulmobridge/discord) |
| [@mulmobridge/line](./line/) | LINE bot (webhook) | Inbound HTTP webhook | **Yes** | [![npm](https://img.shields.io/npm/v/@mulmobridge/line)](https://www.npmjs.com/package/@mulmobridge/line) |
| [@mulmobridge/whatsapp](./whatsapp/) | WhatsApp Cloud API (webhook + HMAC) | Inbound HTTP webhook | **Yes** | [![npm](https://img.shields.io/npm/v/@mulmobridge/whatsapp)](https://www.npmjs.com/package/@mulmobridge/whatsapp) |
| [@mulmobridge/matrix](./matrix/) | Matrix (matrix-js-sdk) | Sync polling to homeserver (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/matrix)](https://www.npmjs.com/package/@mulmobridge/matrix) |
| [@mulmobridge/irc](./irc/) | IRC (irc-framework) | TCP to IRC server (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/irc)](https://www.npmjs.com/package/@mulmobridge/irc) |
| [@mulmobridge/mattermost](./mattermost/) | Mattermost (WebSocket + REST) | WebSocket to Mattermost (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/mattermost)](https://www.npmjs.com/package/@mulmobridge/mattermost) |
| [@mulmobridge/zulip](./zulip/) | Zulip (long-polling events API) | Long polling (outbound HTTP) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/zulip)](https://www.npmjs.com/package/@mulmobridge/zulip) |
| [@mulmobridge/messenger](./messenger/) | Facebook Messenger (webhook + HMAC) | Inbound HTTP webhook | **Yes** | [![npm](https://img.shields.io/npm/v/@mulmobridge/messenger)](https://www.npmjs.com/package/@mulmobridge/messenger) |
| [@mulmobridge/google-chat](./google-chat/) | Google Chat (webhook + JWT/OIDC) | Inbound HTTP webhook | **Yes** | [![npm](https://img.shields.io/npm/v/@mulmobridge/google-chat)](https://www.npmjs.com/package/@mulmobridge/google-chat) |

> **"Public URL needed?"** — Bridges that use inbound webhooks require the bridge process to be reachable from the internet (public IP, ngrok, Cloudflare Tunnel, etc.). Outbound-only bridges (polling / WebSocket) work from behind any NAT or firewall with no extra setup.

## Quick Start

### With MulmoClaude

```bash
# Start the MulmoClaude server on your PC
yarn dev

# Talk from your terminal
npx @mulmobridge/cli@latest

# Or connect a Telegram bot
TELEGRAM_BOT_TOKEN=your-token TELEGRAM_ALLOWED_CHAT_IDS=123 \
  npx @mulmobridge/telegram@latest
```

### With your own agent

The chat-service is backend-agnostic. Inject your own agent function:

```typescript
import express from "express";
import { createServer } from "http";
import { createChatService } from "@mulmobridge/chat-service";

const app = express();
const server = createServer(app);

const chatService = createChatService({
  startChat: async ({ text, attachments }) => {
    const reply = await myAgent.run(text); // your agent here
    return { reply };
  },
  // ... see chat-service README for full deps interface
});

app.use(chatService.router);
chatService.attachSocket(server);
server.listen(3001);
```

Now any MulmoBridge-compatible client can connect — CLI, Telegram, or your own custom bridge.

## Writing a New Bridge

A bridge connects one messaging platform to the chat-service:

```typescript
import { createBridgeClient } from "@mulmobridge/client";

const client = createBridgeClient({ transportId: "my-platform" });

// Forward a user message to the agent
const ack = await client.send(chatId, userText);
if (ack.ok) {
  await replyOnMyPlatform(chatId, ack.reply);
}

// Receive server-initiated pushes
client.onPush((ev) => {
  replyOnMyPlatform(ev.chatId, ev.message);
});
```

The [CLI bridge](./cli/src/index.ts) is a ~50-line reference implementation. See the [Bridge Protocol](../docs/bridge-protocol.md) for the full wire-level spec.

The protocol is plain socket.io 4.x — Python, Go, or any language with a socket.io client can implement a bridge without these TypeScript packages.

## Relation to MulmoClaude

[MulmoClaude](https://github.com/receptron/mulmoclaude) is the GUI chat app where MulmoBridge was born. But the packages are **fully independent**:

- **MulmoClaude uses these packages** — but the packages don't import anything from MulmoClaude
- **Any Express app can host the chat-service** — just inject your agent via the DI interface
- **MIT licensed** — free to use in any project (MulmoClaude itself is also MIT)

We encourage other AI tool projects to adopt MulmoBridge. The protocol is simple, the packages are small, and more bridges + backends means a better ecosystem for everyone.

## Directory Structure

```text
packages/
  protocol/       ← wire types + constants (zero deps)
  chat-service/   ← server-side Express + socket.io service
  client/         ← bridge-side socket.io client + MIME utils
  mock-server/    ← test mock server (echo mode)
  cli/            ← reference bridge: interactive terminal
  telegram/       ← Telegram bot bridge
  slack/          ← Slack bot bridge (Socket Mode)
  discord/        ← Discord bot bridge
  line/           ← LINE bot bridge (webhook)
  whatsapp/       ← WhatsApp Cloud API bridge (webhook)
  matrix/         ← Matrix bridge (matrix-js-sdk)
  irc/            ← IRC bridge (irc-framework)
  mattermost/     ← Mattermost bridge (WebSocket)
  zulip/          ← Zulip bridge (long-polling)
  messenger/      ← Facebook Messenger bridge (webhook)
  google-chat/    ← Google Chat bridge (webhook + JWT)
```

## License

All packages are MIT licensed.
