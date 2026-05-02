# Memory

MulmoClaude keeps a small, durable "what I know about the user" store under `~/mulmoclaude/conversations/memory/`. The agent reads it as part of every turn's system prompt and writes new entries silently when something durable comes up in conversation. The entries are **plain markdown files** the user can read, edit, and version-control.

This doc covers the on-disk layout, the agent's read/write contract, and the one-shot migration that flips a workspace from the legacy "atomic" layout to the current topic-grouped layout.

## File layout (current — topic format)

```
~/mulmoclaude/conversations/memory/
├── MEMORY.md                  # system-owned index (link list per type)
├── preference/
│   ├── tools.md               # one topic file per .md
│   └── workflow.md
├── interest/
│   ├── music.md
│   └── ai-research.md
├── fact/
│   └── travel.md
└── reference/
    └── repos.md
```

Each topic file is a single markdown document with YAML frontmatter:

```yaml
---
type: interest
topic: music
---
# Music

## Rock / Metal
- Pantera, Metallica, Megadeth — long-running listens
- Saw Iron Maiden live in 2024

## Classical
- Chopin nocturnes for focus work
```

- **`type`** — one of `preference` / `interest` / `fact` / `reference`. Source of truth for classification; the directory name is just for ergonomics.
- **`topic`** — slug matching the filename without `.md`. Stable identifier the index links to. Lowercase ASCII, hyphenated, ≤ 60 chars.
- **Body** — H1 with the humanised topic name, then optional H2 sections, then bullets. H2 headings double as "tags" the index surfaces.

The four types and their meanings (also shown to the agent in the Memory Management prompt):

| Type         | What goes here                                 | Examples                                                                 |
| ------------ | ---------------------------------------------- | ------------------------------------------------------------------------ |
| `preference` | Durable habits, preferences, conventions.      | "uses yarn (npm not allowed)", "writes commits in English"               |
| `interest`   | Topics / hobbies / domains followed long-term. | "AI research papers", "Impressionist painting"                           |
| `fact`       | Concrete personal facts that may become stale. | "planning a trip to Egypt", "owns a toaster oven"                        |
| `reference`  | Pointers to internal or external resources.    | "main repo at ~/ss/llm/mulmoclaude", "weekly art-exhibitions-watch task" |

## How the agent reads it

`buildMemoryContext()` in [`server/agent/prompt.ts`](../server/agent/prompt.ts) injects the current memory directly into the system prompt under a `## Memory` section, wrapped in a `<reference type="memory">` envelope so a poisoned entry can't impersonate instructions. The full body of every topic file lands inline; the agent doesn't have to round-trip a tool call to read memory.

`MEMORY.md` is the index, not the source of truth — its line per topic file is `- [name](slug.md) — description` and the H2 headings the file contains. The agent reads the index for shape, then reads bullet bodies inline.

Detection between the legacy "atomic" layout and the current "topic" layout is done at request time in [`topic-detect.ts`](../server/workspace/memory/topic-detect.ts): if any of the canonical type subdirectories (`preference/` / `interest/` / `fact/` / `reference/`) exists under `memory/`, topic format wins. No module-level cache — a manual swap takes effect on the next request.

## How the agent writes it

When the conversation produces something durable enough to remember, the agent writes the new bullet into the topic file that already covers the subject (preferring "append a bullet" over "create a new topic"). The Memory Management section of the system prompt encodes the policy:

1. Pick the topic file from the existing list shown in the Memory section.
2. `Read` it. Choose an H2 section, or append directly under H1 if the topic is small.
3. `Write` the updated file back through the agent's `Write` tool (which routes through `writeFileAtomic` so a crash mid-write can't half-finish).
4. If the bullet introduces a new H2 the user will see in the index, also `Write` a matching `MEMORY.md` line. Otherwise the index regenerates on the next clustering pass.

What NOT to write: ephemeral task state, sensitive material (credentials, SSH keys), duplicates, or anything the user asked the agent to forget.

## The atomic → topic migration

Two on-disk formats coexist for the duration of the migration window. Both are still readable until every active workspace has flipped:

| Layout                     | Filename pattern                               | When written      |
| -------------------------- | ---------------------------------------------- | ----------------- |
| **Atomic** (legacy, #1029) | `<type>_<slug>.md` flat at the memory dir root | Pre-#1070 builds  |
| **Topic** (current, #1070) | `<type>/<topic>.md` under per-type subdirs     | Post-#1070 builds |

The migration is one-shot, idempotent, and runs in the background on server startup. Pipeline:

1. **Pre-conditions** ([`topic-run.ts`](../server/workspace/memory/topic-run.ts)) — workspace has atomic entries; legacy `memory.md` migration has already run; topic format isn't already active. Anything else, return early.
2. **Cluster** ([`topic-cluster.ts`](../server/workspace/memory/topic-cluster.ts)) — call out to an LLM with the full atomic entry list. The LLM returns `{ type → topic → bullets[] }`. The clusterer is injectable so tests use a stub.
3. **Stage** ([`topic-migrate.ts`](../server/workspace/memory/topic-migrate.ts)) — write the clustered files to `conversations/memory.next/<type>/<topic>.md` plus a regenerated `MEMORY.md`. The original `memory/` directory is untouched.
4. **Inspect** — the user diffs `memory/` vs `memory.next/` manually. Auto-swap is opt-in (see below) precisely so the user gets a chance to look first.
5. **Swap** ([`topic-swap.ts`](../server/workspace/memory/topic-swap.ts)) — atomic rename: `memory/` → `memory/.atomic-backup-<ts>/`, then `memory.next/` → `memory/`. The backup name carries a timestamp so re-runs from a richer workspace don't clobber prior backups.

After step 5, the next request reads topic format. The atomic backup stays under `.atomic-backup-<ts>/` indefinitely — it's tiny, and keeping it there means the user can always grep their old layout without restoring anything.

### CLI helper

A user can drive the swap manually:

```bash
yarn memory:swap
```

The script ([`scripts/memory-swap-topic-staging.ts`](../scripts/memory-swap-topic-staging.ts)) wraps `topic-swap.ts`'s library function with a friendly summary.

### Auto-swap window

When the runner detects staging from a prior crash mid-swap, it retries the swap rather than burning another LLM cluster call. The detection is conservative: `memory.next/<type>/` is treated as a "real" topic dir for format-detection purposes ONLY when `memory/` is entirely absent (the actual swap window). When `memory/` still exists with atomic files, `memory.next/<type>/` is just staging being filled and detection stays atomic — see the long comment at the top of [`topic-detect.ts`](../server/workspace/memory/topic-detect.ts) for why this matters.

## Cleanup horizon

The migration scaffolding is one-shot. After every active workspace has flipped, the following code goes in one sweep (search for the `CLEANUP 2026-07-01` markers):

- `topic-migrate.ts`, `topic-cluster.ts`, `topic-swap.ts`, `topic-run.ts`
- `scripts/memory-swap-topic-staging.ts` and the `yarn memory:swap` script entry
- The migration call in `server/index.ts` startup
- The `else` branch in `buildMemoryContext` (atomic + legacy readers) and the `ATOMIC_MEMORY_MANAGEMENT` constant in `server/agent/prompt.ts`
- `io.ts`, `migrate.ts`, `run.ts`, `llm-classifier.ts`, `types.ts` — the atomic-format reader chain

What stays: `topic-types.ts`, `topic-io.ts`, `topic-detect.ts` (minus the atomic-format branch), and the topic half of `buildMemoryContext`.

## Where to read more

- [`plans/feat-memory-topic-restructure.md`](../plans/feat-memory-topic-restructure.md) — design notes for the topic format (#1070 PR-A)
- [`plans/feat-memory-topic-wire.md`](../plans/feat-memory-topic-wire.md) — wire-through plan (#1070 PR-B)
- [`plans/done/feat-memory-storage-utilities.md`](../plans/done/feat-memory-storage-utilities.md) — atomic-format storage layer (#1029 PR-A, legacy)
- [`plans/done/feat-memory-storage-wire.md`](../plans/done/feat-memory-storage-wire.md) — atomic-format wire-through (#1029 PR-B, legacy)
