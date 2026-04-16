# MulmoClaude

Experience GUI-chat with Claude Code — and long-term memory! You chat with Claude Code, and it responds not just with text but with interactive visual tools — documents, spreadsheets, mind maps, images, forms, 3D scenes, piano, and more. A built-in personal wiki gives Claude persistent, structured knowledge that grows with every conversation.

> **Hacking on MulmoClaude?** See [`docs/developer.md`](docs/developer.md) for environment variables, scripts, the process map, sandbox layout, and other contributor-facing notes. Logging knobs live in [`docs/logging.md`](docs/logging.md).

## Installation

**Prerequisites**: Node.js 18+, [Claude Code CLI](https://claude.ai/code) installed and authenticated.

```bash
# Clone the repository
git clone git@github.com:receptron/mulmoclaude.git
cd mulmoclaude

# Install dependencies
yarn install

# Set up environment variables
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
```

## Running the App

```bash
yarn dev
```

This starts both the frontend (Vite) and the backend (Express + Claude Code agent) concurrently. Open [http://localhost:5173](http://localhost:5173) in your browser.

### Why do you need a Gemini API key?

MulmoClaude uses Google's **Gemini 3.1 Flash Image (nano banana 2)** model for image generation and editing. This powers:

- `generateImage` — creates images from text descriptions
- `editImage` — transforms or modifies an existing image (e.g. "convert to Ghibli style")
- Inline images embedded in documents (Recipe Guide, Trip Planner, etc.)

Without a Gemini API key, roles that use image generation will be disabled in the UI.

### Getting a Gemini API key

1. Go to [Google AI Studio](https://aistudio.google.com/apikey)
2. Sign in with your Google account
3. Click **Create API key**
4. Copy the key and paste it into your `.env` file as `GEMINI_API_KEY=...`

The Gemini API has a free tier that is sufficient for personal use.

## Security

MulmoClaude uses Claude Code as its AI backend, which has access to tools including Bash — meaning it can read and write files on your machine.

**Without Docker**, Claude can access any file your user account can reach, including SSH keys and credentials stored outside your workspace. This is acceptable for personal local use, but worth understanding.

**With Docker Desktop installed**, MulmoClaude automatically runs Claude inside a sandboxed container. Only your workspace and Claude's own config (`~/.claude`) are mounted — the rest of your filesystem is invisible to Claude. No configuration is required: the app detects Docker on startup and enables the sandbox automatically.

### Installing Docker Desktop

1. Download Docker Desktop from [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)
2. **macOS**: open the `.dmg` and drag Docker to Applications, then launch it from Applications
3. **Windows**: run the installer and follow the prompts (WSL2 is set up automatically if needed)
4. **Linux**: follow the [Linux install guide](https://docs.docker.com/desktop/install/linux/)
5. Wait for Docker Desktop to finish starting — the whale icon in the menu bar / system tray should turn steady (not animated)
6. Restart MulmoClaude — it will detect Docker and build the sandbox image on first run (one-time, takes about a minute)

When the Docker sandbox is active on macOS, credentials are managed automatically — the app extracts OAuth tokens from the system Keychain at startup and refreshes them on 401 errors, so no manual steps are needed.

If Docker is not installed, the app shows a warning banner and continues to work without sandboxing.

> **Debug mode**: To run without the sandbox even when Docker is installed, set `DISABLE_SANDBOX=1` before starting the server.

## Logging

The server writes readable text to the console and full-fidelity JSON
to rotating daily files under `server/logs/`. Everything is
configurable via `LOG_LEVEL`, `LOG_*_FORMAT`, `LOG_FILE_DIR`, etc.

See [docs/logging.md](docs/logging.md) for the full reference, format
examples, rotation behaviour, and recipes.

## Roles

Each role gives Claude a different persona, tool palette, and focus area:

| Role                | What it does                                                         |
| ------------------- | -------------------------------------------------------------------- |
| **General**         | All-purpose assistant — todos, scheduler, wiki, documents, mind maps |
| **Office**          | Documents, spreadsheets, forms, presentations, data dashboards       |
| **Guide & Planner** | Travel guides, recipe books, trip planners with rich visual output   |
| **Artist**          | Image generation, image editing, generative art with p5.js           |
| **Game**            | Play Othello, or build browser games with Phaser/Three.js            |
| **Tutor**           | Adaptive teaching — evaluates your level before explaining anything  |
| **Storyteller**     | Interactive illustrated stories with images and HTML scenes          |
| **Role Manager**    | Create and edit custom roles                                         |

Switching roles resets Claude's context and swaps in only the tools that role needs — keeping responses fast and focused.

## Skills — Run Your Claude Code Skills from MulmoClaude

MulmoClaude can list and launch the **Claude Code skills** you already have. A skill is any folder under `~/.claude/skills/<name>/` containing a `SKILL.md` file with a YAML frontmatter `description` and a markdown body of instructions. See the [Claude Code Skills docs](https://docs.claude.com/en/docs/claude-code/skills) for details on authoring skills.

### How to use

1. Open MulmoClaude and stay in one of the skill-enabled roles: **General**, **Office**, or **Tutor**.
2. Ask Claude to show your skills — e.g. *"show my skills"* or *"list skills"*.
3. Claude invokes the `manageSkills` tool, and a split-pane **Skills** view opens in the canvas:
   - **Left**: every skill discovered on your machine, with its description and scope badge (`USER` / `PROJECT`).
   - **Right**: the full `SKILL.md` content of the selected skill.
4. Click **Run** on a skill. MulmoClaude sends `/<skill-name>` to Claude as a regular chat message; Claude Code's slash-command machinery resolves it against `~/.claude/skills/` and executes the skill's instructions inline in the same chat session.

No extra typing, no copy-pasting SKILL.md bodies — the Run button is a one-click wrapper around `/skill-name`.

### Skill discovery — two scopes

| Scope       | Location                                | Semantics                                                                                 |
| ----------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| **User**    | `~/.claude/skills/<name>/SKILL.md`      | Personal skills, shared across every project you open with the Claude CLI.                |
| **Project** | `~/mulmoclaude/.claude/skills/<name>/`  | MulmoClaude-workspace-scoped skills. Project scope **wins** if a name collides with user. |

Both scopes are read-only in phase 0 — edits happen on the file system. A future release will let MulmoClaude itself create / edit project-scope skills.

### Docker sandbox vs non-Docker

MulmoClaude's default **Docker sandbox mode** isolates Claude Code in a container for safety (see [Security](#security)). Skill behaviour differs between the two modes:

| Mode                                 | User skills (`~/.claude/skills/`) | Project skills (`~/mulmoclaude/.claude/skills/`) | Built-in CLI skills (`/simplify`, `/update-config`, …) |
| ------------------------------------ | --------------------------------- | ------------------------------------------------ | ------------------------------------------------------ |
| **Non-Docker** (`DISABLE_SANDBOX=1`) | ✅ All work                       | ✅                                               | ✅                                                     |
| **Docker sandbox** (default)         | ⚠️ See caveats below              | ✅ Mounted via workspace volume                  | ✅                                                     |

**Docker caveats — why user skills sometimes don't work in the sandbox:**

- **Symlinked `~/.claude/skills/`** — if your `~/.claude/skills` (or any sub-entry) is a symlink pointing outside `~/.claude/` (for example `~/.claude/skills → ~/ss/dotfiles/claude/skills`), the symlink's target is not present inside the container. The link appears as **dangling**, and Claude Code falls back to only the built-in skills.
- **Older Claude CLI inside the sandbox image** — `Dockerfile.sandbox` pins the CLI version at image build time. If that version is behind your host CLI (e.g. 2.1.96 in the image vs 2.1.105 on the host), user-skill discovery may behave differently.

**Workarounds for skill-rich setups that don't play nicely with the sandbox:**

1. **Disable the sandbox for this session**:

   ```bash
   DISABLE_SANDBOX=1 yarn dev
   ```

   The Claude CLI runs with your real `~/.claude/` and everything resolves natively. Use this when you trust the prompts you're about to send — sandbox is still the recommended default for untrusted / exploratory work.

2. **Move skills into project scope** — copy the specific skills you want into `~/mulmoclaude/.claude/skills/` (this path is mounted as the workspace volume inside the sandbox, so no symlink drama). Great for skills that are specific to your MulmoClaude workflow anyway.

3. **Flatten symlinks** — if you maintain your skill library via symlinks (e.g. in a dotfiles repo), replacing the top-level `~/.claude/skills` symlink with the real directory is the simplest fix.

### What the skill actually receives

When you press **Run**, MulmoClaude sends a plain user turn containing the slash-command string:

```text
/my-skill-name
```

That is the entire payload — MulmoClaude does **not** inline the `SKILL.md` body or extra context. The body is what Claude Code reads when the CLI resolves the slash command on its end. This keeps the chat input small and makes long skills (multi-kilobyte `SKILL.md`) safe to run without blowing up the prompt context.

### Save a conversation as a new skill

After a productive chat, you can ask MulmoClaude to capture the workflow:

```text
"この会話を fix-ci という skill にして"
"save this as a skill called publish-flow"
"skill 化して"   ← Claude picks a slug for you
```

Claude reads the current chat transcript, distills the steps you took, and writes a new `SKILL.md` to `~/mulmoclaude/.claude/skills/<slug>/`. The skill appears in the Skills view immediately and is invokable via `/<slug>` in any future session.

Notes on saving:

- **Project scope only** — saves go to `~/mulmoclaude/.claude/skills/`, never to `~/.claude/skills/`. The user scope stays read-only from MulmoClaude.
- **No overwrite** — if a skill with the same name already exists (in either scope), the save fails and Claude will ask you for a different name.
- **Slug rules** — lowercase letters, digits, and hyphens; 1–64 chars; no leading / trailing or consecutive hyphens. Claude picks one automatically; if you want a specific name, mention it in the request.

### Delete a saved skill

Project-scope skills get a **Delete** button next to the Run button in the Skills view (user-scope skills are read-only — no Delete button shown). Confirming the dialog removes `~/mulmoclaude/.claude/skills/<slug>/SKILL.md`. If you also dropped extra files in that folder by hand, they're left in place; only the SKILL.md is removed.

You can also ask Claude to delete by name:

```text
"delete the fix-ci skill"
```

## Wiki — Long-Term Memory for Claude Code

MulmoClaude includes a **personal knowledge base** inspired by [Andrej Karpathy's LLM Knowledge Bases idea](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f). It gives Claude Code genuine long-term memory — not just a short `memory.md`, but a growing, interconnected wiki that Claude builds and maintains itself.

The **General** role has wiki support built in. Try:

- `"Ingest this article: <URL>"` — Claude fetches the page, extracts key knowledge, creates or updates wiki pages, and logs the activity
- `"What does my wiki say about transformers?"` — Claude searches the index, reads relevant pages, and synthesizes a grounded answer
- `"Lint my wiki"` — health check for orphan pages, broken links, and missing index entries
- `"Show me the wiki index"` — renders the full page catalog in the canvas

### How it works

The wiki lives entirely as plain markdown files in your workspace:

```
workspace/wiki/
  index.md          ← catalog of all pages (title, description, last updated)
  log.md            ← append-only activity log
  pages/<slug>.md   ← one page per entity, concept, or theme
  sources/<slug>.md ← raw ingested sources
```

Claude uses its built-in file tools (`read`, `write`, `glob`, `grep`) to navigate and maintain the wiki — no special database or indexing required. Cross-references use `[[wiki link]]` syntax, which the canvas UI renders as clickable navigation.

Over time the wiki grows into a personal knowledge base that any role can consult, making Claude progressively more useful the more you use it.

## Charts (ECharts)

The `presentChart` plugin renders [Apache ECharts](https://echarts.apache.org/) visualizations in the canvas. Ask for a line, bar, candlestick, sankey, heatmap, or network/graph — Claude writes an ECharts option object, the plugin mounts it. Every chart has a **[↓ PNG]** button for one-click export.

Available in the **General**, **Office**, **Guide & Planner**, and **Tutor** roles. Try:

```text
Chart last quarter's revenue by region as a bar chart
Plot AAPL's daily closes for the last 30 days as a candlestick
Show a sankey of energy flow: coal/gas/solar → electricity → home/industry/transport
```

### Storage

Each `presentChart` call writes one file under `<workspace>/charts/`:

```text
<workspace>/charts/
  sales-overview-1776135210389.chart.json
  apple-stock-1776135300000.chart.json
```

A single document can hold any number of charts, which are rendered stacked in the canvas:

```json
{
  "title": "Apple Stock Analysis",
  "charts": [
    {
      "title": "Daily close",
      "type": "line",
      "option": {
        "xAxis": {
          "type": "category",
          "data": ["2024-01", "2024-02", "2024-03"]
        },
        "yAxis": { "type": "value" },
        "series": [{ "type": "line", "data": [180, 195, 210] }]
      }
    },
    {
      "title": "Volume",
      "type": "bar",
      "option": {
        "xAxis": {
          "type": "category",
          "data": ["2024-01", "2024-02", "2024-03"]
        },
        "yAxis": { "type": "value" },
        "series": [{ "type": "bar", "data": [1000000, 1200000, 950000] }]
      }
    }
  ]
}
```

The `option` field is passed to ECharts' [`setOption`](https://echarts.apache.org/en/api.html#echartsInstance.setOption) as-is — you can reference the full [ECharts option reference](https://echarts.apache.org/en/option.html) when hand-editing these files. Edits are reflected the next time the document is re-opened in the canvas.

## Optional: X (Twitter) MCP Tools

MulmoClaude includes optional MCP tools for reading and searching posts on X (Twitter) via the official X API v2.

| Tool        | What it does                              |
| ----------- | ----------------------------------------- |
| `readXPost` | Fetches a single post by URL or tweet ID  |
| `searchX`   | Searches recent posts by keyword or query |

These tools are **disabled by default** and require an X API Bearer Token to activate.

### Setup

1. Go to [console.x.com](https://console.x.com) and sign in with your X account
2. Create a new app — a Bearer Token is generated automatically
3. Copy the Bearer Token and add it to your `.env`:
   ```
   X_BEARER_TOKEN=your_bearer_token_here
   ```
4. Add credits to your account at [console.x.com](https://console.x.com) (required to make API calls)
5. Restart the dev server — the tools activate automatically

### Usage

These tools are **only available in custom roles**. The built-in roles do not include them by default (except General). To use them in your own role:

1. Switch to the **Role Manager** role
2. Ask Claude to create a custom role, or edit an existing one
3. In the plugin checklist, enable `readXPost` and/or `searchX`

Once configured, you can paste any `x.com` or `twitter.com` URL into the chat and Claude will fetch and read it automatically.

## Configuring Additional Tools (Web Settings)

The gear icon in the sidebar opens a Settings modal where you can extend Claude's tool set without editing code. Changes apply on the next message (no server restart required).

### Allowed Tools tab

Paste tool names one per line. Useful for Claude Code's built-in MCP servers (Gmail, Google Calendar) after a one-time OAuth handshake:

```text
mcp__claude_ai_Gmail
mcp__claude_ai_Google_Calendar
```

First, run `claude mcp` once in a terminal and complete the OAuth flow for each service — credentials persist under `~/.claude/`.

### MCP Servers tab

Add external MCP servers without hand-editing JSON. Two types are supported:

- **HTTP** — remote servers (e.g. `https://example.com/mcp`). Works in every mode; in Docker, `localhost` / `127.0.0.1` URLs are rewritten to `host.docker.internal` automatically.
- **Stdio** — local subprocess, restricted to `npx` / `node` / `tsx` for safety. When Docker sandboxing is enabled, script paths must live under the workspace so they resolve inside the container.

Configuration lives under `<workspace>/configs/`:

```text
<workspace>/configs/
  settings.json    ← extra allowed tool names
  mcp.json         ← Claude CLI --mcp-config compatible
```

The MCP file uses Claude CLI's standard format so you can copy it between machines, or even use it with the `claude` CLI directly.

### Editing the config files directly

Both files are plain JSON — you can edit them with any text editor instead of the Settings UI. The server re-reads them on every message, so:

- No server restart needed after a file edit.
- Changes are picked up by the Settings UI too — just close and reopen the modal.
- The UI and the file are always in sync: saving from the UI overwrites the file, and hand-edits show up in the UI on the next open.

This is handy for:

- Bulk-importing MCP servers from another workstation (copy `mcp.json` over).
- Version-controlling your setup in a dotfiles repo.
- Commenting out a server temporarily by flipping `"enabled": false`.

**Example `mcp.json`** — one remote HTTP server (public, no auth) and one local stdio server:

```json
{
  "mcpServers": {
    "deepwiki": {
      "type": "http",
      "url": "https://mcp.deepwiki.com/mcp",
      "enabled": true
    },
    "everything": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"],
      "enabled": true
    }
  }
}
```

Constraints the server enforces when loading the file:

- `mcpServers` keys (the server id) must match `^[a-z][a-z0-9_-]{0,63}$`.
- HTTP `url` must parse as `http:` or `https:`.
- Stdio `command` is restricted to `npx`, `node`, or `tsx`.
- Entries that fail validation are silently dropped on load (a warning is logged); the rest of the file still applies.

**Example `settings.json`**:

```json
{
  "extraAllowedTools": [
    "mcp__claude_ai_Gmail",
    "mcp__claude_ai_Google_Calendar"
  ]
}
```

You don't need to list `mcp__<id>` entries for servers defined in `mcp.json` — those are allowed automatically on every agent run. `extraAllowedTools` is only for tools that aren't reachable through your own `mcpServers`, typically Claude Code's built-in `mcp__claude_ai_*` bridges after you've run `claude mcp` and completed OAuth.

## Workspace

All data is stored as plain files in the workspace directory:

```
~/mulmoclaude/
  chat/        ← conversation history (one .jsonl per session)
  todos/        ← todo items (todos.json) and kanban columns (columns.json)
  memory.md     ← persistent facts Claude always has in context
  wiki/         ← personal knowledge base (see above)
  ...
```

### Todo explorer

Selecting `todos/todos.json` in the file explorer opens a full **Todo
Explorer** with three view modes:

- **Kanban** — GitHub Projects-style columns. Drag cards between
  columns to change status. Each column has a menu to rename, mark as
  done, or delete. New columns can be added from the toolbar.
- **Table** — sortable table with status / priority / labels / due
  date / created columns. Click a row to inline-edit.
- **List** — flat checklist with the same inline editor.

Status columns are stored in `todos/columns.json` and default to
`Backlog / Todo / In Progress / Done`. Each todo carries optional
`status`, `priority` (low / medium / high / urgent), and `dueDate`
fields in addition to the original text / note / labels / completed
fields.

The chat-side `manageTodoList` MCP tool keeps its existing behaviour
unchanged — it can read and edit text / note / labels / completed
todos, and the explorer's extra fields are preserved across MCP edits.
