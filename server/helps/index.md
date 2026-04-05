# About MulmoClaude

MulmoClaude is a text and task-driven AI agent app with rich visual output. It uses the Claude Code Agent SDK as its LLM core and gui-chat-protocol as its plugin layer.

**Core philosophy**: The workspace is the database. Files are the source of truth. Claude is the intelligent interface.

## Roles

- **General** — Everyday assistant: task management, scheduling, general Q&A.
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

## Workspace Layout

```
~/mulmoclaude/
  chat/        ← session tool results (.jsonl per session)
  todos/       ← todo items
  calendar/    ← calendar events
  contacts/    ← address book
  wiki/        ← personal knowledge wiki
  helps/index.md ← this file; what MulmoClaude is
  memory.md    ← distilled facts loaded into every session
```
