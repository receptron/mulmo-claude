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

- [Transformer Architecture](pages/transformer-architecture.md) — machine-learning, architecture, attention (2026-04-05)
- [さくらインターネット](pages/sakura-internet.md) — クラウド, 日本企業, データセンター (2026-04-06)
- [ECharts DataZoom](pages/echarts-datazoom.md) — ECharts, データ可視化 (2026-04-13)

## タグ一覧

- **AI**: [Transformer Architecture](pages/transformer-architecture.md), [さくらインターネット](pages/sakura-internet.md)
- **日本企業**: [さくらインターネット](pages/sakura-internet.md)
```

Key rules:

- Always write bullet items as `[Title](pages/<slug>.md) — description (YYYY-MM-DD)` — **no** `[[slug]]` wiki-link form, and **no** markdown tables. The canvas parser extracts the slug from the href so non-ASCII titles (日本語, etc.) keep a navigable slug.
- Slugs are lowercase ASCII, hyphen-separated. They match the page filename one-to-one (`pages/sakura-internet.md` → slug `sakura-internet`).
- Group by category if useful, then include a "タグ一覧" / "Tags" section with the same `[Title](pages/<slug>.md)` link form so every mention is clickable.
- Keep the index in sync with `pages/` — when you add a page, add a row; when you rename a file, update every link that points at it.

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
