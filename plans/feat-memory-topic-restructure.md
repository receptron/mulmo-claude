# Memory storage: topic-based restructure (PR-A of #1070)

#1029 introduced the atomic "1 fact = 1 file" layout. After PR #1058 +
#1061 landed, real-world testing showed the granularity is wrong:
interest 41 / fact 50 fragmented into many short files (e.g. 3
separate files for music genres). Cost grows linearly with entry
count and file-explorer browsing is hard.

This PR introduces the **topic-based storage layer** as the
foundation: schema types, IO helpers, and the migration script — but
does NOT wire it into runtime. PR-B handles the agent prompt change
+ migration trigger so the workspace flips atomically.

## Scope (this PR)

- `server/workspace/memory/topic-types.ts` — new types and helpers
  for `<type>/<topic>.md` files. Coexists with the old atomic types
  during the transition.
- `server/workspace/memory/topic-io.ts` — `loadAllTopicFiles` /
  `loadAllTopicFilesSync` / `writeTopicFile` / `regenerateTopicIndex`
  / H2-section extraction. Reuses `parseFrontmatter` /
  `serializeWithFrontmatter` / `writeFileAtomic`.
- `server/workspace/memory/topic-cluster.ts` — LLM-driven clustering
  callback (`MemoryClusterer`). Takes the legacy atomic entries as
  input and returns a mapping `{ type → topic → bullets[] }`. Stub
  callback usable in tests.
- `server/workspace/memory/topic-migrate.ts` — orchestrates: load
  atomic entries → classify → write to staging dir
  (`conversations/memory.next/`). Does NOT swap. The user inspects
  the diff manually.
- `server/workspace/memory/topic-swap.ts` — separate script-grade
  helper that swaps `memory/` ↔ `memory.next/` after user approval,
  retiring the old atomic files into `memory/.atomic-backup/`.
- Tests for parser, H2 extraction, file IO round-trip, cluster
  output formatter, and the staging-dir migration with a stubbed
  clusterer.

## Out of scope (PR-B)

- `server/agent/prompt.ts` `buildMemoryContext` rewrite to use the
  new layout
- Memory Management section rewrite (topic selection, frontmatter
  shape, H2 conventions)
- `server/index.ts` wire of the migration on startup
- Removal / dual-read of legacy atomic format

## Schema

Each topic file is one markdown document:

```yaml
---
type: interest
topic: music
---

# Music

## Rock / Metal
- Pantera, Metallica, …

## Punk / Melodic
- Hi-STANDARD, …
```

`type` ∈ `preference | interest | fact | reference`. `topic` is the
filename (without `.md`). H1 is humanised topic name. H2 sections
become tags via auto-extraction. H2 is optional — a fresh topic
file may have only bullets.

## IO surface

```ts
interface TopicMemoryFile {
  type: MemoryType;
  topic: string;            // filename without extension
  body: string;             // raw markdown body (H1 + H2 + bullets)
  sections: string[];       // H2 headings extracted from body
}

loadAllTopicFiles(workspaceRoot): Promise<TopicMemoryFile[]>
loadAllTopicFilesSync(workspaceRoot): TopicMemoryFile[]
writeTopicFile(workspaceRoot, file): Promise<string>  // returns relative path
regenerateTopicIndex(workspaceRoot): Promise<void>    // rebuilds MEMORY.md
extractH2Sections(body): string[]
```

Reader is forgiving: malformed frontmatter / unparseable file is
logged and skipped (same pattern as #1029 PR-A). Writer goes
through `writeFileAtomic` with `uniqueTmp: true`.

## Index format

```markdown
# Memory Index

## preference
- preference/dev.md — Tooling, Editor, Repo paths
- preference/food.md — Cooking, Ingredients

## interest
- interest/music.md — Rock / Metal, Punk / Melodic, Electronica / Trip-hop, JPop / R&B
- interest/art.md — Impressionism, Museums Tokyo, Exhibitions 2026
- interest/ai-research.md — Papers, LLM, Robotics

## fact
- fact/travel.md — Egypt, NYC
- fact/bootcamp.md — 4th cycle planning, Vibe coding

## reference
- reference/paths.md — Repo, Wiki
- reference/tasks.md — art-watch, kyushu-events-watch, live-concerts-watch
```

Index renders `<type>/<topic>.md — <H2-section-csv>`. If a file has
no H2 sections, the line is just `<type>/<topic>.md`. Sorted by
type (preference / interest / fact / reference) then by topic name.

## Migration approach

`topic-migrate.ts` produces a **staging dir** at
`conversations/memory.next/` so the user can inspect before
committing:

1. Load all atomic entries from current `conversations/memory/*.md`.
2. Single LLM call: pass all entries to the clusterer; get back
   topic mapping + per-bullet placement.
3. Build topic files in `memory.next/<type>/<topic>.md` with H2
   sections grouped by the LLM's sub-categorisation.
4. Generate `memory.next/MEMORY.md` index from the new files.
5. Log "staging ready; run swap" so the user can review with
   `diff -r memory memory.next`.

The swap (separate helper, runs only on user approval):

1. Move existing `memory/` to `memory/.atomic-backup/` (excluding
   the `.next` sibling — they live next to each other so swap is a
   simple rename trick).
2. Rename `memory.next/` to `memory/`.
3. Move the backup snapshot into `memory/.atomic-backup/`.

Swap is intentionally NOT auto-run on first start. PR-B ships the
trigger that creates the staging dir; the swap itself is a manual
acknowledgement step.

## Tests (this PR)

- `topic-types`: H2 extraction from sample bodies (with / without
  H2, with H1 + H2 mix, malformed)
- `topic-io`: round-trip write → read, frontmatter validation,
  reader skips malformed files, sub-directory enumeration, dotfile
  skip
- `topic-migrate`: golden migration with stubbed clusterer
  (deterministic mapping); empty source dir → noop
- `topic-swap`: backup-creation logic, `.atomic-backup/` collision
  resolution

## Followups (PR-B and later)

- PR-B (separate plan) wires `buildMemoryContext` + agent prompt +
  migration trigger
- index auto-regeneration on file change (deferred from #1029 phase
  2)
- `/memory` UI (#1032), expiration (#1033), per-role tag loading
  (#1034), proactive recall (#1035)
