# Wiki — Plan

## Overview

A personal knowledge base that Claude builds and maintains as interconnected markdown files in the workspace. Inspired by [Karpathy's LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

**Core insight**: MulmoClaude's "workspace is the database" philosophy makes it a natural host for a persistent, LLM-maintained wiki. The infrastructure already exists — Claude's built-in file tools (`read`, `write`, `glob`, `grep`) are fully sufficient to create and cross-reference wiki pages.

---

## Workspace Layout

```
workspace/
  wiki/
    index.md          ← content-oriented catalog of all pages (summaries, links)
    log.md            ← append-only chronological activity log
    pages/
      <topic>.md      ← one page per entity, concept, or theme
    sources/
      <slug>.md       ← raw ingested sources (immutable after ingest)
```

`wiki/index.md` and `wiki/log.md` are the two navigation anchors. All other files live under `pages/` or `sources/`.

---

## Three Operations

### Ingest
Process a new source and propagate knowledge across the wiki.

1. Save the raw source to `wiki/sources/<slug>.md`
2. Read and discuss the key takeaways
3. Identify which existing pages need updating (typically 5–15)
4. Create new pages for new entities/concepts
5. Update existing pages with new facts and cross-references
6. Append an entry to `wiki/log.md`
7. Refresh `wiki/index.md`

### Query
Answer a question using the wiki as the knowledge base.

1. Search `wiki/index.md` for relevant page titles
2. Read the relevant pages
3. Synthesize a grounded answer with citations to page names
4. If the answer reveals a gap or new insight worth preserving, file it back as a new/updated page

### Lint
Periodic health check to keep the wiki coherent.

1. Scan all pages for: contradictions, stale claims, orphan pages (not in index), broken cross-references, duplicate topics
2. Produce a report using `presentDocument`
3. Optionally auto-fix minor issues (missing index entries, broken links)

---

## Data Model

Each wiki page is a plain markdown file with optional YAML frontmatter:

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

Cross-references use `[[Page Name]]` wiki-link syntax. Claude resolves these to `pages/<slug>.md` by lowercasing and replacing spaces with hyphens.

---

## Implementation Phases

### Phase 1 — Researcher Role (no new plugin)

Add a `researcher` role to `src/config/roles.ts` whose system prompt:
- Defines the wiki directory layout
- Describes the three operations (ingest, query, lint) as Claude's primary workflows
- Instructs disciplined cross-referencing and `log.md` maintenance
- Uses existing plugins: `browse` (fetch URLs), `presentDocument` (render pages)
- Claude's native file tools handle all read/write/search operations

**Available plugins**: `browse`, `presentDocument`, `generateImage`, `switchRole`

**Sample queries**:
- "Ingest this article: <URL>"
- "What does my wiki say about transformers?"
- "Lint my wiki"
- "Show me the wiki index"

### Phase 2 — `manageWiki` Local Plugin

A dedicated plugin providing structured canvas UI for wiki navigation:

- **`action: 'index'`** — renders `wiki/index.md` as a navigable page list
- **`action: 'page'`** — renders a single page with backlinks highlighted
- **`action: 'log'`** — renders recent activity from `wiki/log.md`
- **`action: 'lint_report'`** — renders the lint results as a structured report

Plugin location: `src/plugins/wiki/`

### Phase 3 — Cross-Role Wiki Awareness

Add a compact wiki hint to all role system prompts so Claude proactively consults and contributes to the wiki when relevant, without bloating prompts with index content.

**Why not inject index.md?** A mature wiki can reach 100+ pages (5–10 KB of table text). Injecting that into every role's system prompt — including Game, Artist, Musician — wastes tokens, slows responses, and provides no value to roles that never need it.

**Approach**: `server/agent.ts` appends a wiki context block to every role's system prompt when the wiki exists:

1. **Read hint** (always, if `wiki/index.md` exists): one sentence describing the layout so Claude can navigate to `wiki/pages/<slug>.md` correctly.

2. **Write hint** (always, if `wiki/SCHEMA.md` exists): one sentence pointing to `wiki/SCHEMA.md` so any role can self-serve the conventions (page format, index update rule, log rule) before writing. This is the "schema" layer from Karpathy's design.

3. **Summary** (if `wiki/summary.md` exists): the file's full contents replace the read hint, giving richer ambient context. The Wiki Manager maintains this as a compact (≤20 line) key-topics list.

**`wiki/SCHEMA.md`**: Created and owned by the Wiki Manager on first ingest. Covers:
- Page format (YAML frontmatter + `[[wiki links]]`)
- Slug naming convention
- Index table format and update rule
- Log append rule

This lets any role contribute a well-formed page — e.g. the Tutor learns something worth keeping and writes it correctly — without carrying the full Wiki Manager system prompt.

---

## Relationship to `memory.md`

`memory.md` (the existing distilled-facts file) and the wiki serve different purposes:

| | `memory.md` | `wiki/` |
|---|---|---|
| Scope | Brief distilled facts always loaded | Deep structured knowledge, loaded on demand |
| Authored by | Claude (distillation) | Claude (wiki maintenance) |
| Consumed by | All roles (always in context) | Wiki Manager directly; all roles via one-line hint or `wiki/summary.md` |
| Growth | Intentionally small | Grows unboundedly |

Over time, Claude can distill key insights from the wiki back into `memory.md` as a compact ambient context for all roles.

---

## Key Design Decisions

1. **Source types for ingest**: text paste (always), URL via `browse` (Phase 1), file drag-drop (future), `camera` for photos (future).

2. **Ingest UX**: Free-form message is sufficient for Phase 1. A `presentForm` intake (title, URL, notes, tags) could improve structure in Phase 2.

3. **Page naming**: Claude chooses the filename slug. Convention: lowercase, hyphen-separated, e.g. `transformer-architecture.md`.

4. **Index format**: `wiki/index.md` is a markdown table or bulleted list with page title, one-line description, and last-updated date. Claude maintains it — no auto-generation tooling needed.

5. **Log format**: Each `log.md` entry is a second-level heading with the date and a bullet list of actions taken (pages created, pages updated, source slug).
