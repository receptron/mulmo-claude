# MulmoBridge — Securely Connect Messaging Apps to Your Personal Computer

MulmoBridge lets you talk to **the AI agent running on your home PC** from **Telegram, LINE, Slack, or any messaging app** — securely, over the internet.

Your personal computer is becoming your most powerful AI assistant. It runs local agents (Claude Code, OpenAI, LangChain, etc.), has access to your files, your calendar, your code. But you're not always at your desk. MulmoBridge is the secure pipe that connects your phone's messaging apps to that agent on your PC, so you can ask it questions, give it tasks, and get results — from anywhere.

**MulmoBridge is not tied to MulmoClaude.** It was extracted from MulmoClaude as an independent, MIT-licensed protocol. We want every AI tool builder to use it — the more agents and messaging platforms speak MulmoBridge, the more useful the ecosystem becomes for everyone.

## How It Works

```text
 Phone messaging apps      Bridge process              Your PC
┌──────────────────┐     ┌────────────────────────┐   ┌────────────────────────────────┐
│  Telegram        │     │ ./bridges/<platform>   │   │ @mulmobridge/chat-service      │
│  LINE            │ ──► │   (or your own bridge  │──►│          ↓                     │
│  Slack, Discord  │     │    built on            │   │ Your AI agent                  │
│  WhatsApp, IRC   │ ◄── │    @mulmobridge/       │◄──│ (MulmoClaude, Claude, GPT,     │
│  ...             │     │    client)             │   │  custom — or @mulmobridge/     │
└──────────────────┘     └────────────────────────┘   │  mock-server for offline tests)│
                            socket.io (secure)        │          ↓                     │
                                                      │  Files, tools, data            │
                                                      └────────────────────────────────┘
```

A **bridge** is a tiny process (~100 lines) that translates between a messaging platform's API and the MulmoBridge socket.io protocol. The platform adapters shipped in this repo live under [`./bridges/`](./bridges/); the `@mulmobridge/client` library handles all the socket.io boilerplate, so writing a new bridge is just writing the platform adapter. For local development you can point a bridge at `@mulmobridge/mock-server` (an echo-mode server speaking the full protocol) to test without a real agent running.

### With @mulmobridge/relay — skip the tunnel for webhook platforms

Four platforms deliver messages via **inbound HTTP webhooks** — [LINE](./bridges/line/), [WhatsApp](./bridges/whatsapp/), [Messenger](./bridges/messenger/), [Google Chat](./bridges/google-chat/). They need the receiver to be reachable from the public internet. You have two options:

- **Run the bridge on your PC + ngrok / Cloudflare Tunnel** — easiest to set up, but the tunnel has to stay up and your PC has to be online whenever a message arrives.
- **[`@mulmobridge/relay`](./relay/) on Cloudflare Workers** — gives you a permanent public URL, queues messages when MulmoClaude is offline (and delivers them on reconnect), and runs on the Cloudflare free tier. Your PC connects *outbound* to the relay via WebSocket, so it keeps working behind any NAT with no tunnel.

```text
 Webhook platforms        Cloudflare Workers          Your PC (any NAT)
┌──────────────────┐     ┌────────────────────────┐   ┌────────────────────────────────┐
│  LINE            │     │ @mulmobridge/relay     │   │ @mulmobridge/chat-service      │
│  WhatsApp        │ ──► │   (webhook receiver    │──►│          ↓                     │
│  Messenger       │     │    + offline queue)    │   │ Your AI agent                  │
│  Google Chat     │ ◄── │                        │◄──│ (MulmoClaude, Claude, …)       │
└──────────────────┘     └────────────────────────┘   └────────────────────────────────┘
    inbound webhook         always-reachable URL        outbound WebSocket only
```

**The other bridges don't need relay.** [CLI](./bridges/cli/), [Telegram](./bridges/telegram/), [Slack](./bridges/slack/), [Discord](./bridges/discord/), [Matrix](./bridges/matrix/), [IRC](./bridges/irc/), [Mattermost](./bridges/mattermost/), [Zulip](./bridges/zulip/) all use outbound polling or WebSocket connections, so they run fine from behind any NAT without a tunnel or a relay.

## Packages

### Core

| Package | Description | npm |
|---|---|---|
| [@mulmobridge/protocol](./protocol/) | Wire protocol types and constants | [![npm](https://img.shields.io/npm/v/@mulmobridge/protocol)](https://www.npmjs.com/package/@mulmobridge/protocol) |
| [@mulmobridge/chat-service](./chat-service/) | Server-side chat service (Express + socket.io, DI-pure) | [![npm](https://img.shields.io/npm/v/@mulmobridge/chat-service)](https://www.npmjs.com/package/@mulmobridge/chat-service) |
| [@mulmobridge/client](./client/) | Bridge-side socket.io client library | [![npm](https://img.shields.io/npm/v/@mulmobridge/client)](https://www.npmjs.com/package/@mulmobridge/client) |
| [@mulmobridge/mock-server](./mock-server/) | Lightweight mock server for testing | [![npm](https://img.shields.io/npm/v/@mulmobridge/mock-server)](https://www.npmjs.com/package/@mulmobridge/mock-server) |
| [@mulmobridge/relay](./relay/) | Cloudflare Workers relay — receives webhooks (LINE, WhatsApp, Messenger, Google Chat), queues offline, forwards via WebSocket | [![npm](https://img.shields.io/npm/v/@mulmobridge/relay)](https://www.npmjs.com/package/@mulmobridge/relay) |

### Bridges

| Package | Description | How it receives messages | Public URL needed? | npm |
|---|---|---|---|---|
| [@mulmobridge/cli](./bridges/cli/) | Terminal bridge | stdin | No | [![npm](https://img.shields.io/npm/v/@mulmobridge/cli)](https://www.npmjs.com/package/@mulmobridge/cli) |
| [@mulmobridge/telegram](./bridges/telegram/) | Telegram bot (photo support, allowlist) | Long polling (outbound HTTP) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/telegram)](https://www.npmjs.com/package/@mulmobridge/telegram) |
| [@mulmobridge/slack](./bridges/slack/) | Slack bot (Socket Mode) | WebSocket to Slack (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/slack)](https://www.npmjs.com/package/@mulmobridge/slack) |
| [@mulmobridge/discord](./bridges/discord/) | Discord bot | WebSocket Gateway (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/discord)](https://www.npmjs.com/package/@mulmobridge/discord) |
| [@mulmobridge/line](./bridges/line/) | LINE bot (webhook) | Inbound HTTP webhook | **Yes** | [![npm](https://img.shields.io/npm/v/@mulmobridge/line)](https://www.npmjs.com/package/@mulmobridge/line) |
| [@mulmobridge/whatsapp](./bridges/whatsapp/) | WhatsApp Cloud API (webhook + HMAC) | Inbound HTTP webhook | **Yes** | [![npm](https://img.shields.io/npm/v/@mulmobridge/whatsapp)](https://www.npmjs.com/package/@mulmobridge/whatsapp) |
| [@mulmobridge/matrix](./bridges/matrix/) | Matrix (matrix-js-sdk) | Sync polling to homeserver (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/matrix)](https://www.npmjs.com/package/@mulmobridge/matrix) |
| [@mulmobridge/irc](./bridges/irc/) | IRC (irc-framework) | TCP to IRC server (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/irc)](https://www.npmjs.com/package/@mulmobridge/irc) |
| [@mulmobridge/mattermost](./bridges/mattermost/) | Mattermost (WebSocket + REST) | WebSocket to Mattermost (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/mattermost)](https://www.npmjs.com/package/@mulmobridge/mattermost) |
| [@mulmobridge/zulip](./bridges/zulip/) | Zulip (long-polling events API) | Long polling (outbound HTTP) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/zulip)](https://www.npmjs.com/package/@mulmobridge/zulip) |
| [@mulmobridge/messenger](./bridges/messenger/) | Facebook Messenger (webhook + HMAC) | Inbound HTTP webhook | **Yes** | [![npm](https://img.shields.io/npm/v/@mulmobridge/messenger)](https://www.npmjs.com/package/@mulmobridge/messenger) |
| [@mulmobridge/google-chat](./bridges/google-chat/) | Google Chat (webhook + JWT/OIDC) | Inbound HTTP webhook | **Yes** | [![npm](https://img.shields.io/npm/v/@mulmobridge/google-chat)](https://www.npmjs.com/package/@mulmobridge/google-chat) |
| [@mulmobridge/mastodon](./bridges/mastodon/) | Mastodon (DM + mention) | WebSocket streaming (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/mastodon)](https://www.npmjs.com/package/@mulmobridge/mastodon) |
| [@mulmobridge/bluesky](./bridges/bluesky/) | Bluesky (chat.bsky DMs) | Long polling (outbound HTTP) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/bluesky)](https://www.npmjs.com/package/@mulmobridge/bluesky) |
| [@mulmobridge/chatwork](./bridges/chatwork/) | Chatwork (Japanese business chat) | Long polling (outbound HTTP) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/chatwork)](https://www.npmjs.com/package/@mulmobridge/chatwork) |
| [@mulmobridge/xmpp](./bridges/xmpp/) | XMPP / Jabber (any server) | XMPP over TLS (outbound) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/xmpp)](https://www.npmjs.com/package/@mulmobridge/xmpp) |
| [@mulmobridge/rocketchat](./bridges/rocketchat/) | Rocket.Chat (DMs) | Long polling (outbound HTTP) | **No** | [![npm](https://img.shields.io/npm/v/@mulmobridge/rocketchat)](https://www.npmjs.com/package/@mulmobridge/rocketchat) |
| [@mulmobridge/signal](./bridges/signal/) | Signal (via signal-cli-rest-api) | WebSocket + REST to local daemon | **No** (daemon local) | [![npm](https://img.shields.io/npm/v/@mulmobridge/signal)](https://www.npmjs.com/package/@mulmobridge/signal) |
| [@mulmobridge/teams](./bridges/teams/) | Microsoft Teams (Bot Framework) | Inbound HTTP webhook | **Yes** | [![npm](https://img.shields.io/npm/v/@mulmobridge/teams)](https://www.npmjs.com/package/@mulmobridge/teams) |

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

The [CLI bridge](./bridges/cli/src/index.ts) is a ~50-line reference implementation. See the [Bridge Protocol](../docs/bridge-protocol.md) for the full wire-level spec.

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
  relay/          ← Cloudflare Workers webhook relay
  bridges/
    cli/          ← reference bridge: interactive terminal
    telegram/     ← Telegram bot bridge
    slack/        ← Slack bot bridge (Socket Mode)
    discord/      ← Discord bot bridge
    line/         ← LINE bot bridge (webhook)
    whatsapp/     ← WhatsApp Cloud API bridge (webhook)
    matrix/       ← Matrix bridge (matrix-js-sdk)
    irc/          ← IRC bridge (irc-framework)
    mattermost/   ← Mattermost bridge (WebSocket)
    zulip/        ← Zulip bridge (long-polling)
    messenger/    ← Facebook Messenger bridge (webhook)
    google-chat/  ← Google Chat bridge (webhook + JWT)
    mastodon/     ← Mastodon bridge (WebSocket streaming)
    bluesky/      ← Bluesky bridge (chat.bsky DMs, long polling)
    chatwork/     ← Chatwork bridge (long polling)
    xmpp/         ← XMPP / Jabber bridge (TLS)
    rocketchat/   ← Rocket.Chat bridge (REST polling)
    signal/       ← Signal bridge (via signal-cli-rest-api)
    teams/        ← Microsoft Teams bridge (Bot Framework)
  scheduler/      ← @receptron/task-scheduler (non-MulmoBridge, general-purpose)
  mulmoclaude/    ← launcher npm package for the MulmoClaude app
```

## Other packages in this directory

This monorepo also hosts a couple of packages that are **not part of MulmoBridge** but live here for publishing convenience. They are independently published and usable outside this project.

| Package | Description | npm |
|---|---|---|
| [@receptron/task-scheduler](./scheduler/) | General-purpose persistent task scheduler with catch-up recovery. Schedule recurring tasks (interval / daily / weekly / one-shot), survive restarts, recover missed runs. Zero dependencies. | [![npm](https://img.shields.io/npm/v/@receptron/task-scheduler)](https://www.npmjs.com/package/@receptron/task-scheduler) |
| [mulmoclaude](./mulmoclaude/) | Launcher npm package for the MulmoClaude app itself — `npx mulmoclaude` to start the GUI chat on `http://localhost:3001`. Bundles the server + client as a ready-to-run distribution. | [![npm](https://img.shields.io/npm/v/mulmoclaude)](https://www.npmjs.com/package/mulmoclaude) |

## License

All packages are MIT licensed.
