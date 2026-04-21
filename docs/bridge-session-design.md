# Bridge Session Design — Current Assumptions & Scaling Plan

## Current Design (Personal Use)

MulmoClaude is designed as a **personal AI workspace** — one user, one machine. The bridge session system reflects this.

### Session Identification

| Key | What it identifies | Example |
|---|---|---|
| `transportId` | Which bridge type | `telegram`, `line`, `cli` |
| `externalChatId` | Which chat within that bridge | Telegram chat ID `99999`, LINE user ID `U12345`, CLI `terminal` |
| `sessionId` | Which MulmoClaude session | `telegram-99999-1713500000000` |

For personal use, `externalChatId` is effectively fixed per bridge (you have one LINE account, one Telegram chat with your bot), so `transportId` alone is usually enough to identify the user.

### Session Switching (`/sessions`, `/switch`)

- `/sessions [page]` lists sessions in pages of 10; the server returns paginated results via `listSessions({ limit, offset })`
- `/switch <number|sessionId>` connects the current chat to a chosen session (by list number or direct session ID)
- `/history [page]` shows recent messages in the current session (5 per page)
- The session list is cached **per `transportId:externalChatId`** in memory (max 1000 entries, 5-minute TTL) so `/switch` resolves correctly even if the same user has multiple bridges open

### Current Limitations

**In-memory cache is bounded but process-local.** The `sessionListCache` Map in `commands.ts` is keyed by `transportId:externalChatId`, capped at 1000 entries, and uses a 5-minute TTL. Sufficient for personal use and small-to-medium services, but for large-scale deployment consider an external cache (Redis) or per-request resolution.

**Session list is global.** `/sessions` returns the same list regardless of who asks. For personal use this is correct (all sessions are yours). For multi-user service, users would see each other's sessions.

**No authentication per user.** The bearer token is shared across all bridges. Anyone with the token can access any session.

## Scaling to Multi-User Service

If MulmoClaude is deployed as a shared service (multiple users via the same bridge), the following changes are needed:

### 1. Per-User Session Isolation

**Problem:** All sessions are visible to all bridge users.

**Solution:** Associate sessions with a user identity. Add `userId` to session metadata and filter `/sessions` by the authenticated user.

```
GET /api/sessions?userId=U12345
→ Only returns sessions owned by U12345
```

### 2. Cache Eviction

**Problem:** Unbounded `sessionListCache` grows with user count.

**Options (pick one):**

| Approach | Complexity | When to use |
|---|---|---|
| **LRU Map with max size** (e.g., 1000 entries) | Low | Small-to-medium service |
| **TTL-based expiry** (e.g., 5 minutes) | Low | Any size, simple to reason about |
| **No cache — resolve by session ID** | None | Change `/switch` to accept session ID instead of number |
| **External cache** (Redis) | High | Large-scale service |

**Recommended for first step:** TTL of 5 minutes + max 1000 entries. If the cache misses, `/switch` returns "Run /sessions again."

### 3. Per-User Authentication

**Problem:** Single shared bearer token.

**Solution:** Per-user tokens or OAuth. The bridge passes user identity in the socket.io handshake, and the server maps it to a user account.

### 4. Rate Limiting

**Problem:** A malicious user could flood `/sessions` requests.

**Solution:** Rate limit per `transportId:externalChatId` — e.g., max 10 `/sessions` calls per minute.

## Migration Path

| Phase | Scope | Effort |
|---|---|---|
| **Current** | Personal use. 1 user, unbounded cache, no auth per user | Done |
| **Phase A** | Add LRU + TTL to sessionListCache | Small (replace Map with bounded Map) |
| **Phase B** | Add userId to session metadata + filter in `/sessions` | Medium |
| **Phase C** | Per-user auth tokens in bridge handshake | Medium |
| **Phase D** | Rate limiting + abuse protection | Small |

Phase A can be done any time as a safety improvement. Phases B-D are only needed when MulmoClaude moves to multi-user deployment.
