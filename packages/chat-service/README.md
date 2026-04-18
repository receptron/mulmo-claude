# @mulmobridge/chat-service

Server-side chat service for [MulmoBridge](https://github.com/receptron/mulmoclaude) — provides socket.io + REST endpoints that connect external bridges (CLI, Telegram, etc.) to a Claude Code agent.

## Install

```bash
npm install @mulmobridge/chat-service express socket.io
```

> `express` and `socket.io` are peer dependencies.

## Overview

The chat-service is a **DI-pure factory** — all host-app concerns (agent runner, session events, role lookup, file persistence, logger) are injected via `ChatServiceDeps`. No direct imports from the host application.

```typescript
import { createChatService } from "@mulmobridge/chat-service";

const chatService = createChatService({
  startChat,        // your agent entry point
  onSessionEvent,   // session event subscriber
  loadAllRoles,     // role list provider
  getRole,          // single role lookup
  defaultRoleId,    // fallback role
  transportsDir,    // directory for transport state files
  logger,           // structured logger ({ error, warn, info, debug })
  tokenProvider,    // optional: bearer token for socket.io auth
});

// Mount the Express router
app.use(chatService.router);

// Attach socket.io to the HTTP server
chatService.attachSocket(httpServer);
```

## Architecture

```text
┌─────────────┐     socket.io      ┌──────────────────┐
│ CLI bridge   │ ◄──────────────► │  chat-service     │
│ TG bridge    │    /ws/chat       │  (this package)   │
│ ...          │                   │                   │
└─────────────┘     REST           │  ┌─────────────┐ │
                  /api/transports  │  │ relay.ts     │ │ ──► startChat()
                                   │  │ socket.ts    │ │ ──► onSessionEvent()
                                   │  │ chat-state   │ │ ──► file persistence
                                   │  │ commands.ts  │ │ ──► /reset, /role
                                   │  │ push-queue   │ │ ──► server→bridge push
                                   │  └─────────────┘ │
                                   └──────────────────┘
```

## Exports

| Export | Description |
|---|---|
| `createChatService(deps)` | Factory — returns `{ router, attachSocket, pushToBridge }` |
| `createRelay(deps)` | Core relay logic (HTTP + socket.io both call this) |
| `CHAT_SOCKET_EVENTS` | Re-exported from `@mulmobridge/protocol` |
| `ChatServiceDeps` | Dependency injection interface |
| `StartChatFn` / `StartChatParams` / `StartChatResult` | Agent entry point types |
| `Attachment` | File attachment interface |

## Part of the MulmoBridge ecosystem

| Package | Description |
|---|---|
| @mulmobridge/protocol | Wire protocol types and constants |
| **@mulmobridge/chat-service** | Server-side chat service (this package) |
| @mulmobridge/client | Bridge client library (coming soon) |
| @mulmobridge/cli | CLI bridge (coming soon) |
| @mulmobridge/telegram | Telegram bridge (coming soon) |

## License

MIT — [Receptron Team](https://github.com/receptron)
