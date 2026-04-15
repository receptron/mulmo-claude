# Plan: information source registry + daily aggregation + on-demand research

Tracks: #166 (the 10-use-case issue)
Supersedes / absorbs: #140 (news batch processing — its scope is covered by this plan's UC-1)

## Scope for this spec — phase 1 only

Phase 1 deliberately excludes auth-requiring sources. Authenticated sources (X / Twitter, private RSS, GitHub with a token, paid APIs) add credential management, token refresh, rate-limit policies, and per-source secrets handling — worth their own phase. The phase-1 surface is:

- **RSS / Atom feeds** (public)
- **Public GitHub REST API** — releases, issues, PRs. Unauthenticated is 60 req/h/IP, plenty for a personal workspace.
- **arbitrary web pages** — fetched via Claude's built-in `web_fetch` tool (not our server). Respects robots.txt because Anthropic's crawler does.
- **web search** — Claude's `web_search` tool for "find news about company X" kind of queries.

Explicit non-goals for phase 1: X, private feeds, Slack / Discord bots, email digests, OAuth, API-key rotation.

## Who fetches?

| Source type | Fetcher | Rationale |
|---|---|---|
| RSS / Atom | **Server-side** | Stable XML format, no LLM needed. Deterministic daily schedule. Cheap (no tokens). |
| GitHub Releases / Issues / PRs | **Server-side** | Typed REST JSON. No LLM value-add in fetching. |
| arXiv / npm / other public REST JSON | **Server-side** | Same. |
| Arbitrary web pages | **Claude-side** (`web_fetch`) | Anthropic's crawler handles robots / caching / user-agent. We don't reimplement browser-grade HTML parsing. |
| Ad-hoc search ("news about company X") | **Claude-side** (`web_search`) | Search API access already built into Claude. |

This split is expressed as a `fetcher` field on each source:

```yaml
fetcher:
  kind: rss          # "rss" | "github-releases" | "github-issues" | "web-fetch" | "web-search" | "arxiv"
  # ... type-specific params
```

The server-side `fetcher.kind` values map to `server/sources/fetchers/*.ts` modules implementing a common `SourceFetcher` interface. Claude-side ones are triggered by emitting a prompt with the right tool call rather than running HTTP ourselves. Auth-requiring fetchers in phase 3 (e.g. `fetcher.kind: "github-authed"`) just register a new module with the same interface — no framework changes.

## Crawl etiquette (for server-side fetching)

1. **User-Agent**: `MulmoClaude-SourceBot/1.0 (+https://github.com/receptron/mulmoclaude)` on every outbound request. Site operators can identify and contact.
2. **robots.txt check** — before fetching any URL whose host we haven't checked in the last 24h, fetch `/robots.txt` and cache the parsed rules. Respect `User-agent: *` entries.
3. **Rate limit** — at most 1 request / source / 60s, configurable. No parallel bursts to the same host.
4. **Respect `Crawl-delay`** from robots.txt if present.
5. **Source-registration preflight** — when the user adds a new web source, run the robots.txt check synchronously and refuse (with a clear message) if the path is disallowed. Offer alternatives: "try the RSS feed at /feed", "use `fetcher.kind: web-search` instead which goes through Claude's approved crawler".
6. **5xx / rate-limit backoff** — exponential backoff per host, persisted to the state file so restarts don't hammer.

Claude-side fetchers don't need our robots checking — the `web_fetch` / `web_search` tools are Anthropic-operated and handle it.

## Workspace layout — sources as files

Matches the `wiki/pages/*.md` pattern: one file per source, YAML frontmatter + optional markdown body.

```text
workspace/
  sources/
    <slug>.md                    ← one file per source
    _index.md                    ← auto-generated index grouped by category
    _state/
      <slug>.json                ← fetcher state per source (last cursor, etag, last-fetched-at, failure count)
      robots/<host>.txt          ← cached robots.txt per host
  news/
    daily/
      YYYY/MM/DD.md              ← daily aggregated summary
    archive/
      <slug>/YYYY-MM.md          ← per-source archive of older items
```

### Source file format

```markdown
---
slug: hn-front-page
title: Hacker News front page
url: https://news.ycombinator.com/rss
fetcher:
  kind: rss
schedule: daily   # "daily" | "hourly" | "weekly" | "on-demand"
categories: [tech-news, general, english]
max_items_per_fetch: 30
added_at: 2026-04-13T09:00:00Z
# Auto-populated by Claude at registration time; user-editable.
---

# Notes

Why registered: general tech news pulse, catch launches.
Override categories: yes (bump `ai` to primary when I have time).
```

The YAML frontmatter is the machine-readable part. The markdown body below `# Notes` is free-form user annotation — Claude reads it for context when summarizing ("this user cares about AI launches on HN").

### Why per-file over a single `registry.yml`?

- One-file-per-source matches the existing wiki convention. Claude can edit a single source without touching the global registry.
- Grep-friendly: `grep -l 'tech-news' sources/*.md` for all tech sources.
- Git diffs stay small and meaningful when Claude tweaks categories or adds notes to one source.
- Auto-categorization rewrites one file, not a 50-source global YAML.

### State vs config split

`sources/<slug>.md` is **config** (user-editable, committed, git-tracked). `sources/_state/<slug>.json` is **runtime state** (last cursor, etag, mtime, backoff timer). State should generally NOT be in git — add `sources/_state/` to `.gitignore` at phase-1-ship time.

## Auto-categorization

At source registration (via the `manageSource` plugin's `register` action):

1. Fetch a tiny sample — RSS: top 3 items; web page: head + title; GitHub repo: `description` + top 3 releases.
2. Spawn a Claude CLI call (reusing the `chat-index/summarizer.ts` pattern — `claude --model haiku --output-format json --json-schema ...`) with a prompt:

   > Classify this information source into 1–5 categories from this fixed taxonomy: `[tech-news, business-news, ai, security, devops, frontend, backend, ml-research, dependencies, product-updates, japanese, english, papers, general, startup, personal]`. Output strict JSON: `{ categories: string[], rationale: string }`.

3. Write the categories into the source file's YAML frontmatter. Write `rationale` into the body as a comment for human review.

Users can override categories manually — the next daily run reads the file as-is. A separate `manageSource recategorize` action re-runs the classifier on demand (e.g. after editing the taxonomy).

**Taxonomy is a fixed enum.** Free-form LLM-generated tags balloon into synonyms (`"artificial-intelligence"` vs `"ai"`) and make filtering useless. The enum lives in `src/plugins/manageSource/taxonomy.ts` and is version-controlled.

## Daily aggregation pipeline

Piggyback on the existing `server/task-manager/` daily schedule (same rhythm as `server/journal/`):

```text
08:00 local time (configurable)
  ↓
maybeAggregateSources({ activeSessionIds })  ← fire-and-forget from task-manager
  ↓
[Phase 1] fetch
  ↓ for each source with schedule=daily and not on backoff:
  ↓   - route by fetcher.kind
  ↓   - server-side fetchers: run directly (respect robots / rate limit / state)
  ↓   - Claude-side fetchers: enqueue a single agent pass that collects all of them in one session
  ↓
[Phase 2] normalize
  ↓ every source produces a list of `SourceItem { id, title, url, publishedAt, summary?, content?, categories }`
  ↓ write raw items to `workspace/news/archive/<slug>/YYYY-MM.md` (append-only)
  ↓
[Phase 3] summarize
  ↓ pass all new items to Claude (one call) with a prompt:
  ↓   "Produce a daily brief. Group by category. Max 10 items per group.
  ↓    For each item: 1-line summary, link, source."
  ↓
[Phase 4] write
  ↓ `workspace/news/daily/YYYY/MM/DD.md`
  ↓ dashboard widget (#143) picks this up
  ↓ if any item tagged `severity: critical` (e.g. from security advisory), enqueue a notification (#142 / #144)
```

The pipeline is invoked by a single public entry `maybeAggregateSources(deps)` that mirrors `maybeRunJournal` / `maybeIndexSession`. Same gates apply: active-session guard, in-process lock, `ClaudeCliNotFoundError` → disable-for-lifetime.

## On-demand research

Triggered when the user says "調べて" during a conversation. Claude decides to call `searchSources({ query, categoryFilter? })` which:

1. Enumerates all registered sources whose categories match the filter.
2. For `fetcher.kind: web-search` sources → Claude uses its `web_search` tool directly.
3. For RSS / GitHub sources → server fetches recent items filtered by query text.
4. Returns aggregated hits. Claude synthesizes the answer and optionally writes it to `wiki/pages/<topic>.md`.

This is the **on-demand** path to UC-3 / UC-4 / UC-5 from #166. Implementation lands after the daily pipeline is stable.

## Plugin interface — `manageSource`

New plugin at `src/plugins/manageSource/`. Actions:

| Action | Params | Effect |
|---|---|---|
| `register` | `url`, optional `fetcher.kind` override, optional `categories` override | Detect source type, run robots preflight, auto-categorize, write the source file |
| `list` | optional `category` filter | Return all registered sources |
| `remove` | `slug` | Delete the source file and its state |
| `recategorize` | `slug` | Re-run the auto-categorizer |
| `fetch` | `slug` | One-shot on-demand fetch outside the schedule |
| `test` | `url` | Dry-run: robots check + fetcher selection + sample fetch, NO write |

The `test` action is the debugging surface: when a user asks "can I register this site?" Claude can run `test` first without polluting the workspace.

## File layout (new code)

```text
server/sources/
  index.ts              ← maybeAggregateSources entry, lock + sentinel
  registry.ts           ← read / write per-source files + state
  taxonomy.ts           ← fixed category enum (shared with src/)
  robots.ts             ← robots.txt fetch + cache + rule evaluation
  pipeline.ts           ← fetch → normalize → summarize → write
  classifier.ts         ← auto-categorize via Claude CLI (reuses chat-index/summarizer patterns)
  types.ts              ← Source / SourceItem / SourceState types
  fetchers/
    index.ts            ← registry of SourceFetcher by kind
    rss.ts              ← RSS / Atom fetcher
    githubReleases.ts   ← GitHub /releases endpoint
    githubIssues.ts     ← /issues and /pulls
    arxiv.ts            ← arXiv API
    webFetch.ts         ← server-side HTML fetch with robots + rate limit
    claudeFetch.ts      ← delegates to an agent session (web_fetch / web_search)
server/routes/sources.ts ← POST /api/sources/* endpoints

src/plugins/manageSource/
  definition.ts
  index.ts
  View.vue
  Preview.vue

test/sources/
  test_robots.ts        ← parse + match User-agent: * rules, cache eviction
  test_rss.ts           ← RSS/Atom parsing
  test_classifier.ts    ← pure helpers, taxonomy pinning
  test_pipeline.ts      ← end-to-end with stubbed fetchers
  test_registry.ts      ← write / read / round-trip source files
```

Reuses the following existing primitives: `task-manager` scheduler, `chat-index/summarizer.ts` for the Claude CLI spawn pattern, `journal/index.ts` for the lock+sentinel+disable-for-lifetime pattern. Nothing new at the framework level.

## Extensibility for future auth (phase 3)

Designed in but not used in phase 1:

1. **`fetcher` is a tagged union.** Adding `{ kind: "github-authed", envVar: "GITHUB_TOKEN" }` or `{ kind: "x-api", envVar: "X_BEARER_TOKEN" }` just means a new file under `server/sources/fetchers/` implementing the same `SourceFetcher` interface.
2. **Source files already have space for auth hints.** Phase 1 ignores them; phase 3 reads them.

   ```yaml
   fetcher:
     kind: github-authed
     envVar: GITHUB_TOKEN
     scopes: [repo:read]   # informational only
   ```

3. **Per-source rate-limit state is already keyed by fetcher kind**, not just host — so per-user-token rate limits in phase 3 fit cleanly.

4. **Secrets policy**: credentials live in `.env` (already protected by the sensitive-file denylist from #148). Never in source files, never in `sources/_state/`.

## Phase breakdown

| Phase | Scope | Gate |
|---|---|---|
| **1 (this spec)** | RSS / GitHub public / arXiv + web_fetch / web_search via Claude + daily pipeline + `manageSource` plugin + auto-categorize + robots etiquette | Ship this PR, iterate in subsequent PRs per fetcher type |
| **2** | On-demand `searchSources` + wiki-page generation for research results + notification hookup | Phase 1 stable in daily use |
| **3** | Auth-bearing fetchers (X / private GitHub / paid APIs) + secrets rotation + per-source rate-limit tuning | Real demand for a specific authed source |

## Resolved decisions

The original spec had 9 open questions; these were worked through in the #188 review thread. Decisions below are what subsequent implementation PRs will follow.

### 1. Taxonomy size — **25 slugs (16 original + 9 expansion)**

Added: `finance` (markets / crypto distinct from `business-news`), `design` (UI/UX — implementation-free complement to `frontend`), `productivity` (tools / workflow / PKM), `science` (broader physics / chem / bio news — `papers` stays academic-only), `health` (medical / fitness / wellness), `gaming`, `climate` (environment / energy / sustainability), `culture` (music / film / books / arts), `policy` (regulation / law / public policy — AI regulation lands here rather than under `ai`).

Rationale: the original 16 were tech-centric enough that everything non-tech collapsed into `general`, defeating the purpose of categorization. Running with a broader table and trimming later (if a slug sees zero use over 2 months) is cheaper than starting small and adding under pressure.

### 2. Daily summary template — **Markdown with a trailing fenced JSON block**

Files under `workspace/news/daily/YYYY/MM/DD.md` are human-readable markdown (headings, bullet items, links). At the tail of the file, a ```` ```json ```` fence contains a compact item index the dashboard (#143) can read without regex-scraping markdown:

````markdown
# Daily brief — 2026-04-13

## AI
- [Anthropic releases Claude 4.7](...) — short summary
- ...

## Security
- ...

```json
{
  "itemCount": 42,
  "byCategory": {"ai": 12, "security": 4, ...},
  "items": [{"id": "...", "title": "...", "url": "...", "categories": [...], "severity": null, "sourceSlug": "..."}]
}
```
````

Markdown viewers render the JSON block as a code block and ignore it; dashboard fetches the file and parses the last fenced block as JSON.

### 3. Item dedup — **Archive keeps everything, daily summary dedups cross-source**

Each per-source archive (`workspace/news/archive/<slug>/YYYY/MM.md`) contains **every** item the fetcher produced for that source — lossless log for retrospective grep. The daily-summary aggregation pass uses a `Set<stableItemId>` (FNV-1a of the normalized URL from `urls.ts`) to drop the second and third occurrence of the same article across sources. Phase-2 can add title-similarity dedup for the "same article, different URL" case; phase-1 URL-hash dedup catches ~95% of real cases at zero extra cost.

### 4. Archive growth — **Keep everything, organize as `archive/<slug>/YYYY/MM.md`**

No compaction, no pruning. 50 sources × 12 months × ~30 items × ~200 bytes ≈ 3.6 MB / year, ~18 MB / 5 years — cheap relative to chat jsonl. The nested `YYYY/MM.md` layout (changed from flat `YYYY-MM.md`) keeps a single year browsable as one directory, matching `daily/YYYY/MM/DD.md`. If storage ever becomes a real problem, phase-3 can add a journal-optimization-style year-end compaction — out of scope for phase 1.

### 5. Failure visibility — **Daily summary footer + `manageSource` UI badge**

Two surfaces, combined:

- **Daily summary footer**: after the per-category sections, a `## Source health` block listing every source that's failed 3+ days in a row (e.g. `⚠ 2 sources still failing: foo (5d), bar (3d)`). Nothing logged for one-day failures — noise. Cheap to add, catches neglected sources.
- **`manageSource` UI badge**: each source row shows last-successful-fetch timestamp and a status badge — green (fresh), yellow (3-6 day failure), red (7+). Actionable: user clicks the failing source, sees the last error, fixes or removes.

**Deferred to later phase**: external notification (#142) at a 7-day threshold. Needs the notification infrastructure to land first — flagged in #142 and #144 so they know about the consumer.

### 6. Timezone — **Local time, matching the journal**

Same `toIsoDate(d)` helper the journal already uses (`getFullYear()` / `getMonth()` / `getDate()` in local). Personal workspace → human time. If we ever go multi-user or daemonize this, UTC becomes more defensible.

### 7. Fetcher execution order — **Parallel across hosts, serial per host**

Group eligible fetchers by URL hostname. Distinct hosts run concurrently (bounded by Node's event loop so it's not literally parallel but close enough). Same-host fetchers serialize with the host's configured per-host rate limit. 50 sources across ~15 distinct hosts ≈ 15-second daily run, down from 75 seconds serial.

Implementation note: a small per-host promise chain (`hostQueues: Map<string, Promise<void>>`) appended to per fetcher. No full job queue needed at phase-1 scale.

### 8. Failure isolation — **Per-source try/catch with log + advance state + continue**

The daily pipeline wraps each fetcher call in try/catch. Failure bumps `consecutiveFailures` in the state file and schedules the next attempt with exponential backoff. One source failing (parser error, HTTP 500, host unreachable) never aborts the remaining fetchers. A pipeline-level catch handles truly fatal errors (`ENOSPC`, `ClaudeCliNotFoundError`) and disables the module for the process lifetime, same as the journal.

### 9. Claude-side fetcher invocation — **5-source batches per CLI spawn, configurable**

The `claude` CLI is spawned via `spawn("claude", ["--print", "--output-format", "json", "--model", "haiku", "--max-budget-usd", ...])` (same pattern as `chat-index/summarizer.ts`). web-fetch and web-search sources are batched into groups of N before each spawn:

```ts
const BATCH_SIZE = Number(process.env.SOURCES_WEB_BATCH_SIZE) || 5;
for (const batch of chunk(webSources, BATCH_SIZE)) {
  await fetchBatchViaCLI(batch);
}
```

Default batch size of 5 was chosen so that:
- 1 CLI spawn pays the ~28k-token cache-creation cost for the system prompt + JSON schema, then processes 5 sources using the cached context. ~4x cheaper than per-source spawns.
- Each batch's inbound content stays well under haiku's 200k context window — 5 × ~5k chars per page ≈ 25k tokens, safe headroom.
- Budget-blowup blast radius is 5 sources at most, not all of them.

Env var override (`SOURCES_WEB_BATCH_SIZE`) lets future tuning happen without code change. At the foundation layer of this PR the constant isn't used yet — it lands in the pipeline PR.

## Test plan (for the phase 1 PR, not this spec)

- Unit: RSS/Atom parser (fixture files), robots parser (happy / allow / disallow / crawl-delay / wildcard), taxonomy classifier (mocked Claude response), URL normalizer (utm stripping, trailing slash).
- Integration: pipeline end-to-end with stubbed fetchers and stubbed summarize — writes expected daily markdown.
- Regression fixture: one real-world RSS feed (frozen snapshot) to catch parser regressions.
- No network tests in CI (stub everything).

## Related issues

- **#166** — the 10-use-case issue this spec addresses
- **#140** — news-batch (superseded; close in favour of this)
- **#143** — dashboard (consumer of daily output)
- **#142** — external notifications (consumer of critical items)
- **#144** — in-app notifications (consumer of critical items)
- **#148** — security hardening (dependency: sensitive-file denylist protects the `.env` our credential storage will use in phase 3)
