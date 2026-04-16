# About MulmoClaude

MulmoClaude is a GUI front-end for Claude Code. It lets you talk to Claude Code through a chat interface with rich visual output, powered by the **GUI Chat Protocol** — a plugin layer that allows Claude to render structured results (documents, spreadsheets, mind maps, images, and more) directly in the canvas alongside the conversation.

Under the hood it uses the Claude Code Agent SDK as its LLM core. Claude has full access to your workspace files and can use built-in tools (read, write, bash, search) as well as GUI Chat Protocol plugins registered as MCP servers.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

## Roles

- **General** — Everyday assistant: task management, scheduling, wiki, mind maps, and general Q&A.
- **Office** — Creates documents, spreadsheets, presentations, and MulmoScript slideshows.
- **Guide & Planner** — Collects your needs via a form, then produces a rich illustrated guide or plan. Works for recipes, travel itineraries, fitness programs, event planning, study guides, DIY projects, and more.
- **Artist** — Generates and edits images, opens a drawing canvas, and creates 3D scenes.
- **Tutor** — Assesses your knowledge level, then teaches any topic with structured documents and visuals.
- **Storyteller** — Crafts illustrated narrative stories as a MulmoScript storyboard.
- **Storyteller Plus** — Like Storyteller, with consistent character images across beats.
- **Role Manager** — Create, edit, and delete custom roles.
- *(Additional roles may be defined by the user in the workspace.)*

## Key Capabilities

- Manage a todo list and calendar scheduler
- Present documents and spreadsheets with rich formatting
- Generate and edit images
- Create interactive mind maps
- Generate and edit HTML pages / 3D scenes
- Present MulmoScript multimedia stories
- Manage a personal knowledge wiki
- Switch between roles mid-conversation
- Ask clarifying questions via interactive forms
- Play browser games

## Wiki — Long-Term Memory

The wiki (`wiki/` in the workspace) acts as Claude's long-term memory. Unlike the conversation history which resets each session, the wiki is a persistent, compounding knowledge base that Claude builds and maintains over time. You feed it sources — articles, URLs, notes — and Claude ingests them into structured, interlinked Markdown pages. The more you add, the smarter it gets.

See [Wiki](helps/wiki.md) for details on how it works.

## Help Pages

- [Wiki](helps/wiki.md) — how the personal knowledge wiki works, its folder layout, page format, and operations
- [MulmoScript](helps/mulmoscript.md) — format reference for authoring multimedia stories: beats, image types, speech, audio, and a minimal example
- [Business Presentation Template](helps/business.md) — MulmoScript template and rules for business presentations in the Office role
- [Spreadsheet](helps/spreadsheet.md) — cell format, formulas, date handling, and format codes for the presentSpreadsheet plugin
- [Sandbox](helps/sandbox.md) — how the Docker sandbox isolates the agent, what it can access, and how to disable it

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
