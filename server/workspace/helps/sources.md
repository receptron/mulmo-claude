# Information Sources

This page describes the information-source registry: how to register feeds, how the daily-brief pipeline lays out its files, and how to answer questions from the data already on disk.

## Three Operations

### Register

Ask the user for the canonical URL (RSS feed URL, GitHub repo URL, or arXiv listing URL), infer `fetcher_kind` from it, and populate the fetcher-specific params (added as flat top-level YAML keys) accordingly:

- **`rss`** — `{ rss_url: <feed URL> }`
- **`github-releases`** / **`github-issues`** — `{ github_repo: "<owner>/<name>" }`. Pick releases vs. issues based on user intent.
- **`arxiv`** — `{ arxiv_query: <search query, e.g. cat:cs.CL> }`

Let the auto-classifier pick categories by default — omit the `categories` field unless the user explicitly specifies some.

### List

Call `manageSource` with `action='list'` so the canvas displays the registry.

### Rebuild

When the user asks to "rebuild" / "refresh" / "aggregate today's brief", call `manageSource` with `action='rebuild'`.

### After any action

Every `manageSource` action's response already includes the refreshed list — you usually don't need a follow-up `action='list'` call.

## Data Layout

The pipeline reads and writes these files under the workspace root:

- **`sources/<slug>.md`** — source config. Flat YAML frontmatter: `slug`, `title`, `url`, `fetcher_kind`, `schedule`, `categories`, `max_items_per_fetch`, `added_at`. Any unrecognized top-level keys (e.g. `rss_url`, `github_repo`, `arxiv_query`) become fetcher-specific params. Body is `notes`.
- **`sources/_state/<slug>.json`** — runtime state: `lastFetchedAt`, `cursor`, `consecutiveFailures`, `nextAttemptAt`.
- **`news/daily/YYYY/MM/DD.md`** — the aggregated daily brief: markdown body plus a trailing fenced JSON block listing items.
- **`news/archive/<slug>/YYYY/MM.md`** — per-source monthly archive. Lossless; no cross-source dedup.

## Reading vs. Rebuilding

When the user asks questions like *"summarize last week's AI news"*, *"what's new on HN today"*, or *"show me articles about <topic>"*, **read the relevant daily / archive files directly with the Read tool** rather than re-running the pipeline — the data is already there. Use Glob to enumerate date ranges when needed.

Only call `action='rebuild'` when the user explicitly asks to refresh, or when the daily file for today is missing.
