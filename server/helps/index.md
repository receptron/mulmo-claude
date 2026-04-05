# About MulmoClaude

MulmoClaude is a GUI front-end for Claude Code. It lets you talk to Claude Code through a chat interface with rich visual output, powered by the **GUI Chat Protocol** — a plugin layer that allows Claude to render structured results (documents, spreadsheets, mind maps, images, and more) directly in the canvas alongside the conversation.

Under the hood it uses the Claude Code Agent SDK as its LLM core. Claude has full access to your workspace files and can use built-in tools (read, write, bash, search) as well as GUI Chat Protocol plugins registered as MCP servers.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

## Roles

- **General** — Everyday assistant: task management, scheduling, wiki, general Q&A.
- **Office** — Creates and edits documents, spreadsheets, and presentations.
- **Brainstorm** — Explores ideas via mind maps, images, and documents.
- **Recipe Guide** — Step-by-step cooking instructor.
- *(Additional roles may be defined by the user in the workspace.)*

## Key Capabilities

- Manage a todo list and calendar scheduler
- Present documents and spreadsheets with rich formatting
- Generate and edit images
- Create interactive mind maps
- Generate and edit HTML pages / 3D scenes
- Present MulmoScript multimedia stories
- Show music visualizations
- Manage a personal knowledge wiki
- Switch between roles mid-conversation
- Ask clarifying questions via interactive forms
- Play games (Othello)

## Wiki — Long-Term Memory

The wiki (`wiki/` in the workspace) acts as Claude's long-term memory. Unlike the conversation history which resets each session, the wiki is a persistent, compounding knowledge base that Claude builds and maintains over time. You feed it sources — articles, URLs, notes — and Claude ingests them into structured, interlinked Markdown pages. The more you add, the smarter it gets.

See [Wiki](helps/wiki.md) for details on how it works.

## Help Pages

- [Wiki](helps/wiki.md) — how the personal knowledge wiki works, its folder layout, page format, and operations

## Workspace Layout

```
~/mulmoclaude/
  chat/          ← session tool results (.jsonl per session)
  todos/         ← todo items
  calendar/      ← calendar events
  contacts/      ← address book
  wiki/          ← personal knowledge wiki (long-term memory)
  helps/         ← help pages (synced from app on every start)
  memory.md      ← distilled facts loaded into every session
```
