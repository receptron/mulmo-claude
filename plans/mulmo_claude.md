# MulmoClaude — Plan

## Overview

A next-generation agent app built on **Claude Code** as the LLM core and **gui-chat-protocol** as the plugin layer. It replaces MulmoChat's voice-first, OpenAI-realtime architecture with a text/task-driven agent that produces rich visual output and operates directly on a user's file system.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

---

## Key Differences from MulmoChat

| Aspect | MulmoChat | MulmoClaude |
|---|---|---|
| LLM core | OpenAI Realtime API (WebRTC) | Claude Code (Agent SDK) |
| Interaction mode | Voice-first | Text/task-first |
| Tool execution | Plugins only | Plugins + native file/bash/computer use |
| Memory | None (stateless) | Chat history + memory.md as files |
| Data storage | None | File system (todos, calendar, contacts) |
| Context on role switch | Persists | Resets (fresh context per role) |
| Transport | WebRTC | HTTP streaming |

---

## Architecture

### LLM Core: Claude CLI

The agent runs by spawning the `claude` CLI binary as a subprocess. This uses Claude Code's existing local authentication — no API key required.

```
User text input
      ↓
spawn("claude", ["-p", message, "--output-format", "stream-json", ...])
      ↓ agent loop (automatic, inside CLI)
  ├── Built-in tools (bash, read, write, glob, grep)   ← file system ops
  └── MCP servers (role's gui-chat-protocol plugins)   ← visual output (TODO)
            ↓
      stream-json events → SSE → Vue canvas
```

The CLI is invoked with:
- `-p` — non-interactive (print) mode
- `--output-format stream-json --verbose` — streaming JSON events
- `--system-prompt` — role persona + workspace path + date
- `cwd: workspacePath` — scopes file tool access to the workspace

### Plugin Layer: gui-chat-protocol

**Package**: `gui-chat-protocol` (LLM-agnostic, no changes needed)

All visual output follows the gui-chat-protocol standard:
- **ToolDefinition**: JSON Schema for Claude's function calling
- **ToolResult**: Standardized result with `data`, `jsonData`, `instructions`
- **ViewComponent**: Full canvas view per tool result
- **PreviewComponent**: Sidebar thumbnail per tool result

### MCP Server Per Role Switch (TODO)

Plugins will be exposed to the CLI via `--mcp-config`, pointing to HTTP-based MCP servers served by the Express app. This lets MCP server handlers access the active SSE stream to push `ToolResult` events to the frontend canvas while returning a text summary to Claude.

Only the current role's plugins are registered — context stays lean.

### ToolContextApp Extension

The new app extends `ToolContextApp` with file system access for file-backed plugins (todo, calendar, contacts). The base interface already supports this via `Record<string, (...args) => any>`:

```typescript
interface MulmoClaudeToolContextApp extends ToolContextApp {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  workspacePath: () => string;
}
```

### Workspace

The app uses a fixed workspace at `~/mulmoclaude`. On first launch, the server initializes it automatically — no user selection required. All data lives here as plain files.

```
workspace/
  chat/                        ← conversation history + tool results
    2026-03-29T12-34-56Z.jsonl  ← ToolResults for one session (JSON Lines)
    2026-03-29T13-00-00Z.jsonl  ← new file on each session start or role switch
  todos/
    inbox.md
    projects/
      app-redesign.md
  calendar/
    2026-03.md
    2026-04.md
  contacts/
    john-doe.md
  memory.md                     ← distilled facts always loaded as context
```

---

## Roles

A role defines:
1. **Persona** — system prompt
2. **Plugin palette** — available gui-chat-protocol plugins
3. **Memory scope** — which history files are loaded as context
4. **Context reset** — switching roles always starts a fresh conversation

All roles have access to Claude Code's native file tools (read, write, bash, glob, grep). The plugin palette shapes *what visual outputs* are available, not what the agent can do to the file system.

### Built-in Roles

| Role | Persona | Key Plugins |
|---|---|---|
| **General** | Route to appropriate role | switchRole |
| **Developer** | Coding agent | code preview, diff viewer, browser |
| **Office** | Business document assistant | presentDocument, spreadsheet, presentation |
| **Brainstorm** | Creative facilitator | mindMap, generateImage, presentDocument |
| **Tutor** | Adaptive teacher | putQuestions, presentDocument, generateImage |
| **MulmoCaster** | Multimedia storyteller | showPresentation |
| **Organizer** | Personal productivity | todo, calendar, contacts |

---

## File System as Database

Core app data is stored as **Markdown + YAML frontmatter** files. This format is:
- Human-readable and editable in any text editor
- Parseable by Claude without special tools
- Version-controllable with git
- Portable and syncable (iCloud, Dropbox, etc.)

### Todo

```markdown
---
id: todo-001
status: open
due: 2026-04-01
tags: [work, urgent]
related: [contacts/john-doe.md]
---

# Refactor auth middleware

Notes and context here.
```

### Calendar Event

```markdown
---
id: cal-001
date: 2026-04-01T14:00
duration: 60m
attendees: [contacts/john-doe.md]
related: [todos/projects/app-redesign.md]
---

# Design review with John
```

### Contact

```markdown
---
id: contact-001
email: john@example.com
phone: +1-555-0100
tags: [work]
---

# John Doe

Notes about this contact.
```

Cross-referencing is done via relative file paths in frontmatter — no foreign keys, no joins, just file reads.

---

## Chat History & Memory

### Session Files

Each session gets a dedicated file created when the agent starts or the role switches. The file uses ISO timestamp naming for natural sort order:

```
chat/YYYY-MM-DDTHH-MM-SSZ.jsonl
```

The first line is a metadata entry identifying the session:

```json
{"type": "session_meta", "roleId": "organizer", "startedAt": "2026-03-29T12:34:56Z"}
```

Subsequent lines are JSON-serialized `ToolResult` objects (JSON Lines format), appended as results arrive. No role subfolder — all sessions are flat in `chat/`.

### Context Loading Strategy

When starting a session in a role:
1. Always load `memory.md` (distilled persistent facts)
2. Load last N session files from `chat/`
3. Claude can search deeper history via grep when needed

### memory.md

A curated file Claude updates when important facts are established — decisions, preferences, recurring context. Similar to a CLAUDE.md but user-facing.

---

## Core App Plugins (New)

These plugins render file-backed data visually and write changes back to files on user interaction:

| Plugin | Visual Output | Writes Back To |
|---|---|---|
| `todo` | Interactive checklist | `todos/*.md` |
| `calendar` | Month/week view | `calendar/*.md` |
| `contacts` | Contact card(s) | `contacts/*.md` |
| `fileTree` | Navigable directory tree | (read-only) |
| `diffViewer` | File diff display | (read-only) |
| `docReader` | Render any file (PDF, md, CSV) | (read-only) |

---

## Interaction Model

1. On first launch, server creates `~/mulmoclaude/` with subdirs and `git init`s it
2. User selects a role (or starts with General)
3. User types a task
4. Claude agent loop runs:
   - Reads relevant context (memory.md, recent history, workspace files)
   - Decides which tools to call (native file tools and/or plugins)
   - Executes tools, streams results to canvas
5. Visual output appears in canvas via gui-chat-protocol ViewComponents
6. ToolResults are appended to `chat/{timestamp}.jsonl` as they arrive
7. On role switch: canvas clears, context resets, a new session file is created

---

## Tech Stack

- **Frontend**: Vue 3 + gui-chat-protocol components
- **Agent**: `claude` CLI binary — spawned as subprocess, uses existing Claude Code auth
- **Plugin protocol**: `gui-chat-protocol` — framework-agnostic, LLM-agnostic, no changes needed
- **Server**: Express.js (SSE streaming, future HTTP MCP server for plugins)
- **Storage**: Local file system (`~/mulmoclaude/`, plain markdown files)

---

## Open Questions

1. **Multi-workspace** — support switching between workspaces, or one at a time?
2. **File watcher** — should the app watch for external file changes and update the canvas?
3. **Security** — sandbox Claude's file access to the workspace directory only, or allow broader access?
4. **Mobile** — is this desktop-only, or should the file model work on mobile too?
