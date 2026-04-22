# @mulmobridge/slack

> **Experimental** — please test and [report issues](https://github.com/receptron/mulmoclaude/issues/new). Your feedback helps us improve.

Slack bridge for [MulmoClaude](https://github.com/receptron/mulmoclaude). Uses **Socket Mode** — no public URL or ngrok needed.

日本語: [`README.ja.md`](README.ja.md)

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name it (e.g. "MulmoClaude") and pick your workspace

### 2. Configure permissions

**OAuth & Permissions** → add these Bot Token Scopes:
- `chat:write` — send messages
- `channels:history` — read messages in public channels
- `groups:history` — read messages in private channels
- `im:history` — read direct messages
- `mpim:history` — read group DMs

### 3. Enable Socket Mode

**Socket Mode** → toggle **Enable Socket Mode** → create an App-Level Token with `connections:write` scope. Copy the `xapp-...` token.

### 4. Enable Events

**Event Subscriptions** → toggle **Enable Events** → subscribe to:
- `message.channels`
- `message.groups`
- `message.im`
- `message.mpim`

### 5. Install to workspace

**Install App** → **Install to Workspace** → copy the `xoxb-...` Bot User OAuth Token.

### 6. Run the bridge

```bash
# With mock server (for testing)
npx @mulmobridge/mock-server &
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
MULMOCLAUDE_AUTH_TOKEN=mock-test-token \
npx @mulmobridge/slack

# With real MulmoClaude
SLACK_BOT_TOKEN=xoxb-... \
SLACK_APP_TOKEN=xapp-... \
npx @mulmobridge/slack
```

### 7. Invite the bot

In Slack, invite the bot to a channel: `/invite @MulmoClaude`

---

## Session granularity (new!)

> **What's a "session"?** In MulmoClaude, a *session* is one continuous conversation with the AI — it remembers what you said earlier and builds on it. Each Slack bridge setting below decides **how many sessions one Slack channel maps to**.

You pick the behaviour via the `SLACK_SESSION_GRANULARITY` environment variable. Three modes:

### 🗂 `channel` (default) — one session per channel

Everything posted in `#ai-help` counts as **one long conversation**, no matter who posts or whether they use threads.

```text
#ai-help
├── Alice: "Summarize yesterday's standup"          ┐
├── Alice: "Translate that to Japanese"             │  ← One session.
├── Bob:  "What about the action items?"            │    AI remembers
│   ├── Alice: "Focus on the ones assigned to me"   │    every message
│   └── Bob:  "Cool, thanks"                        │    above.
└── Alice: "Draft a status update based on that"    ┘
```

**When to use:** small teams or a private `@claude` DM where every message is part of the same running conversation.

**Watch out:** after a few weeks, the session accumulates a lot of context. The AI starts pulling in stale details, and responses get slower / more expensive. Start a *new channel* if you want a fresh start.

### 🧵 `thread` — one session per Slack thread

Posts in the root of the channel still share one session (as in `channel` mode), but **replies inside a thread get their own isolated session**.

```text
#ai-help
├── Alice: "Summarize yesterday's standup"          ┐
├── Alice: "Translate that to Japanese"             │  ← Channel session
│                                                   │    (root posts only)
├── Bob:  "What about the action items?"   ──────── ┤
│   │                                               │
│   ├── Alice: "Focus on the ones assigned to me"   ├  ← Thread session #1
│   └── Bob:  "Cool, thanks"                        │    (independent of
│                                                   │     channel session)
├── Alice: "Draft a status update"        ───────── ┤
│   ├── Dev:  "Include the deploy notes too"        ├  ← Thread session #2
│   └── Alice: "Perfect"                            │
```

**When to use:** a shared `#ai-help` or `#general` with multiple people asking unrelated questions. Threads keep conversations separate so the AI doesn't mix "Alice's translation task" with "Bob's deploy question".

**Watch out:** because each thread = a new session, the AI doesn't automatically know context from other threads in the same channel. If Alice asks the bot in a thread "use the same style as yesterday's post", the bot won't find that post unless Alice quotes it or opens the thread from that post.

### 🤖 `auto` — future auto-detection (reserved)

Currently behaves **exactly like `thread`**. This slot is reserved for a future smarter behaviour (e.g., "infer from channel naming conventions").

### Quick comparison

| Mode | Root post | Thread reply | Best for |
|---|---|---|---|
| `channel` *(default)* | → channel session | → **channel session** (same conversation) | 1:1 DMs, small teams |
| `thread` | → channel session | → thread session (new conversation) | Busy shared channels |
| `auto` | (same as `thread`) | (same as `thread`) | Future-proof |

### How to choose

| You want… | Set it to… |
|---|---|
| "Keep it simple. All messages in one channel = one conversation." | `channel` (or just leave it unset) |
| "Don't mix my question with other people's questions in the same channel." | `thread` |
| "I'll leave it for the future. Pick a reasonable default for me." | `auto` |

### Switching modes safely

Changing the granularity **does not delete any existing sessions**. It only changes how *new* messages map to sessions. Your old conversations stay intact in the MulmoClaude UI.

That said, if you switch from `channel` → `thread`, messages that were previously part of one long channel session will — from this point on — spawn new thread sessions instead. The AI won't automatically "port" the old context into the new threads.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SLACK_BOT_TOKEN` | Yes | `xoxb-...` Bot User OAuth Token |
| `SLACK_APP_TOKEN` | Yes | `xapp-...` App-Level Token (connections:write) |
| `SLACK_ALLOWED_CHANNELS` | No | CSV of channel IDs to restrict access (empty = all) |
| `SLACK_SESSION_GRANULARITY` | No | `channel` *(default)* \| `thread` \| `auto`. See above. |
| `MULMOCLAUDE_API_URL` | No | Default `http://localhost:3001` |
| `MULMOCLAUDE_AUTH_TOKEN` | No | Bearer token (auto-read from workspace if not set) |

## License

MIT
