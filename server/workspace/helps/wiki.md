# Wiki

The wiki is a personal knowledge base that Claude builds and maintains as interconnected Markdown files in the workspace. It is available in the **General** role.

The idea originated from [Andrej Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

## The Core Idea

Most people's experience with LLMs and documents resembles RAG: upload files, retrieve relevant chunks at query time, generate answers. The LLM rediscovers knowledge from scratch on every question — there is no accumulation.

The wiki is different. Instead of retrieving from raw documents at query time, Claude **incrementally builds and maintains a persistent wiki** — a structured, interlinked collection of Markdown files. When you add a new source, Claude doesn't just index it. It reads it, extracts key information, and integrates it into the existing wiki: updating entity pages, revising topic summaries, noting contradictions, strengthening synthesis.

**The wiki is a persistent, compounding artifact.** Cross-references are already there. Contradictions are flagged. The synthesis reflects everything you've read. The wiki grows richer with every source and every question.

You never write the wiki yourself — Claude writes and maintains all of it. You curate sources, explore, and ask questions. Claude does the summarizing, cross-referencing, filing, and bookkeeping.

## What You Can Do With It

- **Research**: go deep on a topic over weeks or months — reading papers, articles, reports, building a comprehensive wiki with an evolving thesis.
- **Reading a book**: file each chapter as you go, building pages for characters, themes, plot threads, and connections.
- **Personal knowledge**: track goals, health, self-improvement — file journal entries, articles, podcast notes, and build a structured picture over time.
- **Business**: feed Slack threads, meeting transcripts, project documents into a wiki that stays current because Claude does the maintenance.

## Your Role vs. Claude's Role

**Your job**: curate sources, direct the analysis, ask good questions, think about what it all means.

**Claude's job**: summarizing, cross-referencing, filing, updating pages, maintaining consistency, bookkeeping — everything that makes humans abandon wikis because the maintenance burden grows too fast.

## Three Operations

### Ingest

Drop a source (article, URL, text) and ask Claude to process it.

Claude will: read the source, identify key entities and concepts, create or update 5–15 wiki pages, add cross-references, append a log entry, and refresh the index. Show the updated index in the canvas when done.

### Query

Ask any question. Claude searches `data/wiki/index.md` for relevant pages, reads them, and synthesizes a grounded answer with citations. Good answers can be filed back into the wiki as new pages — a comparison you asked for, an analysis, a connection you discovered — so they don't disappear into chat history.

### Lint

Ask Claude to health-check the wiki. It scans for contradictions, stale claims, orphan pages, missing cross-references, and concepts that deserve their own page, then fixes issues automatically.

## Chat About a Page

Every wiki page has a built-in chat composer at the bottom. Ask a question, press send, and Claude starts a fresh chat session already pointed at that specific page — the agent reads the page first, then answers with that context loaded.

This is one of the defining features of MulmoClaude. Your wiki is not a static archive: every page is a live entry point into a conversation with Claude about what's on it.

Why it matters:

- **Instant deep dive.** Open any page, ask _"how does this relate to X?"_ or _"summarize the main argument"_ or _"what would change if Y were false?"_ — no need to name the page or construct a prompt.
- **Scoped grounding.** The prompt pins the page path, so Claude starts from that page rather than searching the index from scratch. Answers stay tight to the material you're actually looking at.
- **Clean sessions.** Each question spawns its own chat, so spending half an hour drilling into one page doesn't pollute an existing working session. Good answers can be filed back into the wiki as their own pages.

The composer appears on the standalone Wiki view (one of the top-level tabs). When a wiki page is embedded as a tool result inside another chat, that chat's own composer is used instead — no nested sessions.

## Folder Layout

```
data/wiki/
  index.md          ← catalog of all pages (title, one-line summary, last updated)
  log.md            ← append-only chronological activity log
  summary.md        ← compact key-topics list (loaded into every session as ambient context)
  SCHEMA.md         ← conventions for page format, index updates, and log entries
  pages/
    <topic>.md      ← one page per entity, concept, or theme
  sources/
    <slug>.md       ← raw ingested sources (immutable after ingest)
```

## Page Format

Each page is a plain Markdown file with YAML frontmatter:

```markdown
---
title: Transformer Architecture
created: 2026-04-05
updated: 2026-04-05
tags: [machine-learning, architecture, attention]
---

# Transformer Architecture

Brief summary paragraph...

## Key Concepts

...

## Related Pages

- [[Attention Mechanism]]
- [[BERT]]
- [[GPT]]
```

Cross-references use `[[Page Name]]` wiki-link syntax. Slugs are lowercase, hyphen-separated (e.g. `transformer-architecture.md`).

## `index.md` Format

`data/wiki/index.md` is the catalog — one bullet per page using standard markdown link syntax with the slug embedded in the href. This format works both in-app (the canvas parses it) and in any plain markdown viewer (GitHub, VS Code preview, etc.).

```markdown
# Wiki Index

## ページ一覧

- [Transformer Architecture](pages/transformer-architecture.md) — foundational seq2seq model #ml #attention #architecture (2026-04-05)
- [さくらインターネット](pages/sakura-internet.md) — 日本のクラウド事業者 #クラウド #日本企業 #データセンター (2026-04-06)
- [ECharts DataZoom](pages/echarts-datazoom.md) — ズーム操作の仕組み #echarts #可視化 (2026-04-13)

## タグ一覧

- **AI**: [Transformer Architecture](pages/transformer-architecture.md), [さくらインターネット](pages/sakura-internet.md)
- **日本企業**: [さくらインターネット](pages/sakura-internet.md)
```

Key rules:

- Prefer bullet items as `[Title](pages/<slug>.md) — description #tag1 #tag2 (YYYY-MM-DD)` — avoid the `[[slug]]` wiki-link form. The canvas parser extracts the slug from the href so non-ASCII titles (日本語, etc.) keep a navigable slug. Markdown tables are also supported via the alternative format below, but the bullet form is easier to read in plain text and plays nicer with non-ASCII titles.
- Slugs are lowercase ASCII, hyphen-separated. They match the page filename one-to-one (`pages/sakura-internet.md` → slug `sakura-internet`).
- `#tag` tokens appear inline in the description (whitespace-bounded on the left). Tokens are extracted and indexed for the Wiki tag-filter UI. Tags accept any Unicode letter or digit (so `#クラウド`, `#可視化`, `#ai-agents` all work); `-` and `_` are allowed as internal joiners but not as the first character. Separate adjacent tags with a space — there is no right-hand boundary char, so `#クラウドデータ` parses as one tag.
- Group by category if useful, then include a "タグ一覧" / "Tags" section with the same `[Title](pages/<slug>.md)` link form so every mention is clickable.
- Keep the index in sync with `pages/` — when you add a page, add a row; when you rename a file, update every link that points at it.

### Alternative table format

If you prefer a table layout, the canvas also accepts a `Tags` column. Column names are matched by header (case-insensitive), so the order is flexible:

```markdown
| Slug | Title | Summary | Tags | Updated |
|------|-------|---------|------|---------|
| `transformer-architecture` | Transformer Architecture | foundational seq2seq model | ml, attention, architecture | 2026-04-05 |
```

Pre-existing 3- or 4-column tables (without a Tags header) keep parsing; their entries just have no tags.

## Tag rules

- A page's YAML frontmatter `tags:` field is the source of truth for that page's tags.
- The tags recorded for that slug in `index.md` must match the frontmatter set exactly (order and case don't matter; we compare as a lowercased set).
- `manageWiki` `action: "lint_report"` flags any mismatch as **Tag drift**. Fix by updating whichever side is stale.

## Canvas Tool

Use the `manageWiki` tool to display wiki content in the canvas:

- `action: "index"` — show the page catalog
- `action: "page"` — show a single page (provide `pageName`)
- `action: "log"` — show the activity log
- `action: "lint_report"` — run a health check

## Relationship to `memory.md`

|        | `memory.md`                              | `data/wiki/`                                |
| ------ | ---------------------------------------- | ------------------------------------------- |
| Scope  | Brief distilled facts, always in context | Deep structured knowledge, loaded on demand |
| Growth | Intentionally small                      | Grows unboundedly                           |

Over time, Claude can distill key insights from the wiki back into `memory.md` as compact ambient context for all roles.
