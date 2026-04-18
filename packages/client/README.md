# @mulmobridge/client

Shared socket.io client library for all MulmoBridge bridges. Handles connection setup, bearer-token authentication, and the send/receive wire protocol so each bridge only needs to implement its platform adapter.

## Install

```bash
npm install @mulmobridge/client
# or
yarn add @mulmobridge/client
```

## Exports

| Export | Description |
|---|---|
| `createBridgeClient(opts)` | Create a connected socket.io client with auth |
| `requireBearerToken()` | Read the bearer token or exit with a helpful message |
| `readBridgeToken()` | Read the bearer token (returns `null` if absent) |
| `TOKEN_FILE_PATH` | Path to `~/mulmoclaude/.session-token` |
| `mimeFromExtension(ext)` | Map file extension to MIME type |
| `isImageMime(mime)` | Check if MIME is an image type |
| `isPdfMime(mime)` | Check if MIME is PDF |
| `isSupportedAttachmentMime(mime)` | Check if MIME can be sent to Claude |
| `parseDataUrl(url)` | Parse `data:mime;base64,data` strings |
| `buildDataUrl(mime, b64)` | Build a data URL from components |
| `MessageAck` | Acknowledgement returned by `client.send()` |
| `PushEvent` | Server-push event delivered to `client.onPush()` |
| `BridgeClientOptions` | Options accepted by `createBridgeClient()` |
| `BridgeClient` | Client interface returned by `createBridgeClient()` |
| `ParsedDataUrl` | Parsed data URL components |

## Usage

```typescript
import { createBridgeClient } from "@mulmobridge/client";

const client = createBridgeClient({ transportId: "my-bridge" });

const ack = await client.send("chat-123", "Hello!");
if (ack.ok) {
  console.log(ack.reply);
}

client.onPush((ev) => {
  console.log(`Push from ${ev.chatId}: ${ev.message}`);
});
```

## Ecosystem

Part of the `@mulmobridge/*` package family:

- **@mulmobridge/protocol** — shared types and constants
- **@mulmobridge/client** — this package
- **@mulmobridge/cli** — interactive terminal bridge
- **@mulmobridge/telegram** — Telegram bot bridge
- **@mulmobridge/chat-service** — server-side chat service

## License

MIT
