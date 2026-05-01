# @mulmobridge/protocol

Shared types and constants for the [MulmoBridge](https://github.com/receptron/mulmoclaude) chat protocol — the wire-level contract between the chat-service (server) and external bridges (CLI, Telegram, etc.).

## Install

```bash
npm install @mulmobridge/protocol
```

## What's included

| Export | Description |
|---|---|
| `EVENT_TYPES` | Agent SSE event type discriminants (`"text"`, `"error"`, `"session_finished"`, …) |
| `EventType` | Union type of all event type strings |
| `CHAT_SOCKET_EVENTS` | Socket.io event names (`"message"`, `"push"`) |
| `CHAT_SOCKET_PATH` | Socket.io endpoint path (`"/ws/chat"`) |
| `ChatSocketEvent` | Union type of socket event names |
| `CHAT_SERVICE_ROUTES` | REST endpoint patterns for the bridge API |
| `Attachment` | File attachment interface — either inline base64 `data` or workspace `path`, with optional `mimeType`/`filename` |

## Usage

```typescript
import {
  EVENT_TYPES,
  CHAT_SOCKET_EVENTS,
  CHAT_SOCKET_PATH,
  type Attachment,
} from "@mulmobridge/protocol";

// Discriminate agent events
if (event.type === EVENT_TYPES.text) {
  console.log(event.message);
}

// Connect via socket.io
const socket = io(serverUrl, { path: CHAT_SOCKET_PATH });
socket.on(CHAT_SOCKET_EVENTS.push, (event) => {
  // handle server push
});

// Send with attachment
const attachment: Attachment = {
  mimeType: "image/png",
  data: base64EncodedData,
};
```

## Versioning

This package follows [Semantic Versioning 2.0](https://semver.org/spec/v2.0.0.html).
External authors writing bridges or other consumers can rely on the rules below.

| Bump | Triggered by |
|---|---|
| **MAJOR** | Breaking change to a published export — renaming or removing a field on `EVENT_TYPES` / `Attachment` / `CHAT_SOCKET_*` / `CHAT_SERVICE_ROUTES` / `GENERATION_*` / `BridgeOptions`, or any other type or constant exported from `index.ts`. |
| **MINOR** | Additive change — new optional fields, new event/discriminant entries, new exported helpers. Always backwards-compatible. |
| **PATCH** | Bug fixes, doc updates, build metadata. No public-API surface change. |

Every release is recorded in [`CHANGELOG.md`](./CHANGELOG.md). Breaking
releases also get a [`MIGRATIONS.md`](./MIGRATIONS.md) entry with concrete
upgrade steps.

**Pinning.** Pin against the caret (`^`) range that matches the semver tier
you care about — e.g. `"@mulmobridge/protocol": "^0.2.0"`. This receives all
backwards-compatible 0.2.x changes, and any future 0.3.0+ bump will require an
explicit upgrade.

**Pre-1.0.** While we are still on 0.x, a minor bump (`0.x → 0.(x+1)`) is
treated as a breaking change per the SemVer 0.x convention. We declare the
contract stable enough to depend on — but reserve the option to evolve it
without going to 1.0.0 first.

## Part of the MulmoBridge ecosystem

| Package | Description |
|---|---|
| **@mulmobridge/protocol** | Wire protocol types and constants (this package) |
| [@mulmobridge/chat-service](https://www.npmjs.com/package/@mulmobridge/chat-service) | Server-side chat service |
| [@mulmobridge/client](https://www.npmjs.com/package/@mulmobridge/client) | Bridge client library |
| [@mulmobridge/cli](https://www.npmjs.com/package/@mulmobridge/cli) | CLI bridge |
| [@mulmobridge/telegram](https://www.npmjs.com/package/@mulmobridge/telegram) | Telegram bridge |

## Ecosystem

Part of the [`@mulmobridge/*`](https://www.npmjs.com/~mulmobridge) package family.

**Shared libraries:**

- [`@mulmobridge/client`](https://www.npmjs.com/package/@mulmobridge/client) — socket.io client library used by every bridge below
- [`@mulmobridge/protocol`](https://www.npmjs.com/package/@mulmobridge/protocol) — wire types and constants  ← **this package**
- [`@mulmobridge/chat-service`](https://www.npmjs.com/package/@mulmobridge/chat-service) — server-side relay + session store
- [`@mulmobridge/relay`](https://www.npmjs.com/package/@mulmobridge/relay) — Cloudflare Workers webhook proxy
- [`@mulmobridge/mock-server`](https://www.npmjs.com/package/@mulmobridge/mock-server) — mock server for local bridge development

**Bridges** (one npm package per platform):

- [`@mulmobridge/bluesky`](https://www.npmjs.com/package/@mulmobridge/bluesky) — Bluesky DMs over atproto
- [`@mulmobridge/chatwork`](https://www.npmjs.com/package/@mulmobridge/chatwork) — Chatwork (Japanese business chat)
- [`@mulmobridge/cli`](https://www.npmjs.com/package/@mulmobridge/cli) — interactive terminal bridge
- [`@mulmobridge/discord`](https://www.npmjs.com/package/@mulmobridge/discord) — Discord bot via Gateway
- [`@mulmobridge/email`](https://www.npmjs.com/package/@mulmobridge/email) — IMAP poll + SMTP reply, threading preserved
- [`@mulmobridge/google-chat`](https://www.npmjs.com/package/@mulmobridge/google-chat) — Google Chat via MulmoBridge relay
- [`@mulmobridge/irc`](https://www.npmjs.com/package/@mulmobridge/irc) — IRC (Libera, Freenode, custom)
- [`@mulmobridge/line`](https://www.npmjs.com/package/@mulmobridge/line) — LINE Messaging API via MulmoBridge relay
- [`@mulmobridge/line-works`](https://www.npmjs.com/package/@mulmobridge/line-works) — LINE Works (enterprise LINE)
- [`@mulmobridge/mastodon`](https://www.npmjs.com/package/@mulmobridge/mastodon) — Mastodon DMs + mentions
- [`@mulmobridge/matrix`](https://www.npmjs.com/package/@mulmobridge/matrix) — Matrix / Element
- [`@mulmobridge/mattermost`](https://www.npmjs.com/package/@mulmobridge/mattermost) — Mattermost
- [`@mulmobridge/messenger`](https://www.npmjs.com/package/@mulmobridge/messenger) — Facebook Messenger via MulmoBridge relay
- [`@mulmobridge/nostr`](https://www.npmjs.com/package/@mulmobridge/nostr) — Nostr NIP-04 encrypted DMs
- [`@mulmobridge/rocketchat`](https://www.npmjs.com/package/@mulmobridge/rocketchat) — Rocket.Chat
- [`@mulmobridge/signal`](https://www.npmjs.com/package/@mulmobridge/signal) — Signal via signal-cli-rest-api
- [`@mulmobridge/slack`](https://www.npmjs.com/package/@mulmobridge/slack) — Slack Socket Mode
- [`@mulmobridge/teams`](https://www.npmjs.com/package/@mulmobridge/teams) — Microsoft Teams via Bot Framework
- [`@mulmobridge/telegram`](https://www.npmjs.com/package/@mulmobridge/telegram) — Telegram bot
- [`@mulmobridge/twilio-sms`](https://www.npmjs.com/package/@mulmobridge/twilio-sms) — SMS via Twilio Programmable Messaging
- [`@mulmobridge/viber`](https://www.npmjs.com/package/@mulmobridge/viber) — Viber Public Account bots
- [`@mulmobridge/webhook`](https://www.npmjs.com/package/@mulmobridge/webhook) — generic HTTP webhook bridge
- [`@mulmobridge/whatsapp`](https://www.npmjs.com/package/@mulmobridge/whatsapp) — WhatsApp Cloud API via MulmoBridge relay
- [`@mulmobridge/xmpp`](https://www.npmjs.com/package/@mulmobridge/xmpp) — XMPP / Jabber
- [`@mulmobridge/zulip`](https://www.npmjs.com/package/@mulmobridge/zulip) — Zulip


## License

MIT — [Receptron Team](https://github.com/receptron)
