# MulmoClaude

Experience GUI-chat with long-term memory! You chat with Claude Code, and it responds not just with text but with interactive visual tools — documents, spreadsheets, mind maps, images, forms, 3D scenes, piano, and more. A built-in personal wiki gives Claude persistent, structured knowledge that grows with every conversation.

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

## Roles

Each role gives Claude a different persona, tool palette, and focus area:

| Role | What it does |
|---|---|
| **General** | All-purpose assistant — todos, scheduler, wiki, documents, mind maps |
| **Office** | Documents, spreadsheets, forms, presentations, data dashboards |
| **Guide & Planner** | Travel guides, recipe books, trip planners with rich visual output |
| **Artist** | Image generation, image editing, generative art with p5.js |
| **Game** | Play Othello, or build browser games with Phaser/Three.js |
| **Tutor** | Adaptive teaching — evaluates your level before explaining anything |
| **Storyteller** | Interactive illustrated stories with images and HTML scenes |
| **Musician** | Compose and play music in the browser |
| **Role Manager** | Create and edit custom roles |

Switching roles resets Claude's context and swaps in only the tools that role needs — keeping responses fast and focused.

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

## Workspace

All data is stored as plain files in the workspace directory:

```
~/mulmoclaude/
  chat/        ← conversation history (one .jsonl per session)
  todos/        ← todo items
  memory.md     ← persistent facts Claude always has in context
  wiki/         ← personal knowledge base (see above)
  ...
```