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
| `Attachment` | File attachment interface (`mimeType` + base64 `data` + optional `filename`) |

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

## Part of the MulmoBridge ecosystem

| Package | Description |
|---|---|
| **@mulmobridge/protocol** | Wire protocol types and constants (this package) |
| [@mulmobridge/chat-service](https://www.npmjs.com/package/@mulmobridge/chat-service) | Server-side chat service |
| [@mulmobridge/client](https://www.npmjs.com/package/@mulmobridge/client) | Bridge client library |
| [@mulmobridge/cli](https://www.npmjs.com/package/@mulmobridge/cli) | CLI bridge |
| [@mulmobridge/telegram](https://www.npmjs.com/package/@mulmobridge/telegram) | Telegram bridge |

## License

MIT — [Receptron Team](https://github.com/receptron)
