# MulmoClaude

GUI front-end for Claude Code — chat with rich visual output, schema-driven data apps, and long-term memory. AI-native application platform that runs locally on your machine.

## Quick Start

```bash
# Prerequisites: Node.js 20+, Claude Code CLI
npm install -g @anthropic-ai/claude-code
claude              # one-time OAuth — completes the CLI setup

# Launch MulmoClaude
npx mulmoclaude@latest
```

Your browser opens to `http://localhost:3001`. That's it.

> Closing the terminal stops the server. Run inside `tmux` / `screen` (macOS / Linux) or a Task Scheduler task (Windows) to keep it up.

## What can you do?

| Ask Claude to…                  | What you get                                          |
| ------------------------------- | ----------------------------------------------------- |
| "Write a project proposal"      | Rich markdown document in the canvas                  |
| "Chart last quarter's revenue"  | Interactive ECharts visualization                     |
| "Create a trip plan for Kyoto"  | Illustrated guide with images                         |
| "Set up a todo list"            | Schema-driven collection with table / kanban / calendar |
| "Ingest this article: URL"      | Wiki page with `[[links]]` for long-term memory       |
| "Schedule a daily news digest"  | Recurring task that runs automatically                |
| "Generate an image of a sunset" | AI-generated image (Gemini)                           |
| "Make slides on …"              | Marp-rendered slide deck with PDF export              |
| "Add this to my calendar"       | Event in your Google Calendar (sign in, no setup)     |
| "Put that on my task list"      | Task in Google Tasks, with notes and a due date       |
| "Subscribe to this RSS feed"    | Data feed on `/feeds`, fetched on a schedule          |

**Pages you can visit directly**: `/wiki` (browse + lint), `/feeds` (data feeds), `/collections` (data apps — Discover tab to import community collections, Contribute to share your own), `/automations` (recurring tasks), `/files`, `/skills`, `/roles`. Each page has its own chat composer that spawns a fresh chat already aware of the page context.

## Options

```
npx mulmoclaude                              # Default (port 3001, opens browser)
npx mulmoclaude --port 8080                  # Custom port
npx mulmoclaude --no-open                    # Don't open browser
npx mulmoclaude --disable-sandbox            # Run the agent directly on the host
npx mulmoclaude --dev-plugin ./my-plugin     # Load a runtime plugin from a local
                                             # project dir (repeatable; relative or
                                             # absolute path)
npx mulmoclaude --version                    # Show version
```

## How it works

The npm package ships with the pre-built client (Vite) and the server source — TypeScript, executed directly via `tsx`. No cloning, no build step for end users: `npx` downloads the package and starts the Express server.

Your data lives in `~/mulmoclaude/` (created on first run): conversations, memory, calendar, contacts, wiki, collections, scheduled tasks, generated artifacts. Plain files; the workspace IS the database.

## Sandbox (recommended)

When Docker is available, the Claude Code agent runs inside a credential-free Docker sandbox so it can't see anything outside the workspace. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) and the launcher detects it automatically.

The sandbox is off by default for credentials (`gh auth`, SSH keys). Opt into the host's credential flow for the agent's `git` / `gh` commands:

```bash
SANDBOX_FORWARD_SSH_AGENT=1 \
SANDBOX_MOUNT_CONFIGS=gh \
  npx mulmoclaude
```

Or run directly on the host (no sandbox, full access):

```bash
npx mulmoclaude --disable-sandbox
```

## Bridges — talk to MulmoClaude from messaging apps

Bridges are separate npx-able processes that connect a messaging platform to the running server via socket.io. Each bridge supports real-time text streaming; CLI / Telegram also support file attachments.

```bash
# Run the server first (any terminal)
npx mulmoclaude

# Then in another terminal, any of:
npx @mulmobridge/cli@latest          # interactive CLI on the same machine
npx @mulmobridge/telegram@latest     # Telegram bot (needs TELEGRAM_BOT_TOKEN)
npx @mulmobridge/slack@latest        # Slack
npx @mulmobridge/discord@latest      # Discord
npx @mulmobridge/line@latest         # LINE
npx @mulmobridge/whatsapp@latest     # WhatsApp
npx @mulmobridge/email@latest        # Email (IMAP + SMTP)
# …matrix, mastodon, bluesky, signal, teams, zulip, irc, rocketchat,
#   chatwork, xmpp, viber, messenger, google-chat, twilio-sms, webhook, nostr, line-works
```

Full bridge list and platform-specific setup: <https://github.com/receptron/mulmoclaude/blob/main/docs/mulmobridge-guide.md>

### Auth token persistence across server restarts

The server regenerates a fresh bearer token on every startup and writes it to `~/mulmoclaude/.session-token`. A bridge that started before the restart keeps the OLD token in memory, so every subsequent API call returns 401 silently.

Fix: set `MULMOCLAUDE_AUTH_TOKEN` to the same long random value on both the server and the bridge. The server uses it verbatim instead of regenerating, so the token survives restarts.

```bash
# Server (one-time setup — pin a strong random value)
MULMOCLAUDE_AUTH_TOKEN=long-random-string npx mulmoclaude

# Bridge (separate process / machine — same value)
MULMOCLAUDE_AUTH_TOKEN=long-random-string \
  TELEGRAM_BOT_TOKEN=… \
  npx @mulmobridge/telegram@latest
```

Recommended: ≥ 32 characters of random data (shorter values trigger a startup warning).

## Roles, skills, and collections

- **Roles** (sidebar selector): General, Office, Guide & Planner, Artist, Tutor, Storyteller, Settings. Each one biases Claude toward a workflow and surfaces its sample prompts.
- **Skills** (`~/.claude/skills/<name>/SKILL.md`): personal skills shared across every project, plus project skills under `<workspace>/.claude/skills/`. Bundled "preset" skills (`mc-*`) re-seed on each boot.
- **Collections**: schema-driven data apps. Author your own (`data/skills/<slug>/schema.json` declares the model + UI), or use the Discover tab on `/collections` to import community collections from the official registry — or your own org / community registry by dropping `config/collections-registries.json` in the workspace. The Map tab draws the ontology graph across your collections, so you can see how their records reference each other.

## Optional features

- **Gemini API key** (`GEMINI_API_KEY` in environment or `.env`) — enables AI image generation (`generateImage`), audio / video. Free tier suffices for everyday use; get one from [Google AI Studio](https://aistudio.google.com/).
- **Local voice input** (macOS only, opt-in) — `whisper.cpp` for dictating chat messages without sending audio to a cloud API.
- **Marp slides** — `marp: true` frontmatter on any markdown file renders a slide deck in the canvas with PDF export. Custom themes via `config/marp-themes/<name>.css`.
- **Auto memory** — the agent maintains a typed memory layout (`conversations/memory/<type>/<topic>.md`) and reads it ambient-style.
- **Web Push on task finish** — enable in Settings → Notifications to get a push on your phone when the answer to a question you asked is ready, even with the browser closed. Requires the RemoteHost connection + a registered device (see [`docs/remote-host.md`](https://github.com/receptron/mulmoclaude/blob/main/docs/remote-host.md#web-push-on-task-finish-2086)).
- **Google (Calendar / Tasks / Drive)** — link your Google account in Settings → Plugins → Google and consent in the browser; no Google Cloud setup needed. The agent then gets a `google` tool (list / create events, tasks, and files it creates in your Drive), and the phone remote can trigger the same commands. **The refresh token stays on your machine** (`~/.config/mulmo/`) — the sign-in service applies the OAuth client secret Google requires and keeps nothing. Prefer your own OAuth client? Drop a *desktop-app* client JSON in `~/.secrets/` and the whole flow stays local (see [`docs/remote-host.md`](https://github.com/receptron/mulmoclaude/blob/main/docs/remote-host.md)).

## Plugin authoring (`--dev-plugin`)

`--dev-plugin <path>` is the runtime-plugin author's dev loop. Pair with `yarn dev` in the plugin directory (vite watch): edits → vite rebuilds `dist/` → the browser auto-reloads via a debounced watcher on the plugin's `dist/`. The plugin's `package.json#name` + `dist/index.js` must already be present; the launcher refuses to start on missing files or on a name collision with an already-installed plugin.

Server-side `definePlugin` factory edits still require a launcher restart (Node ESM has no cache invalidation API); the launcher log explicitly says so when `dist/index.js` changes.

## For developers

- Repo: <https://github.com/receptron/mulmoclaude>
- Architecture, scripts, and the publish flow live in `docs/developer.md` of the repo.
- Publish flow for this package: see `bin/prepare-dist.js` header comment plus `.claude/skills/publish-mulmoclaude/SKILL.md`.

## License

MIT
