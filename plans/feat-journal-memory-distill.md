# feat: auto-distill user-level memory entries during daily pass

Tracks #236.

## Goal

Extend the daily journal pass so the archivist also produces user-level memory entries — facts the LLM should "remember about the user" across sessions. These flow into `~/mulmoclaude/memory.md`, which is already inlined into every Claude system prompt by `server/agent/prompt.ts#buildMemoryContext`.

Today the archivist outputs a daily summary + topic notes. There is no automatic path for capturing things like "the user prefers yarn" or "mulmoclaude phase 1 is in flight" — those have to be put into `memory.md` by hand.

## Non-goals

- **Optimization / pruning** of memory.md (deferred to a follow-up that mirrors `optimizationPass.ts`).
- **Manual edit UI** — users edit memory.md via the file system / Claude Edit tool, same as today.
- **Semantic dedup** — we trust the LLM to skip facts already present in the input we hand it.
- **Per-session capture** — memory entries land via the daily pass like everything else, not on every turn.

## Categories

Same four-bucket scheme used by Claude Code's auto-memory system globally:

| type | What goes in it |
|---|---|
| **user** | Who the user is, role, expertise, environment ("macOS + Docker", "OSS maintainer at receptron") |
| **feedback** | Corrections / preferences ("don't blindly accept all CodeRabbit suggestions", "prefer yarn over npm", "PR descriptions in Japanese") |
| **project** | Ongoing work / deadlines / status ("skills phase 1 in PR #234", "v0.1.0 tagged 2026-04-14") |
| **reference** | External systems / paths / dashboards ("skills repo at ~/ss/dotfiles/claude/skills/", "Linear project INGEST tracks pipeline bugs") |

## Storage layout

memory.md is a single file with one `##`-headed section per category, in the canonical order above. Section bodies are bullet lists. Empty sections are omitted from the file (re-added when the first entry of that type lands).

```markdown
# Memory

Distilled facts about you and your work.

## User

- macOS + Docker Desktop environment
- Primary repos: receptron/mulmoclaude

## Feedback

- Prefer yarn over npm; never suggest npm commands
- PR descriptions in Japanese

## Project

- skills phase 1 PR #234 awaiting review
- v0.1.0 tagged 2026-04-14

## Reference

- External skill repo: ~/ss/dotfiles/claude/skills/ (symlink)
```

Plain bullet lines, no per-entry frontmatter, no IDs. Keeps memory.md hand-editable.

## Architecture

### New module — `server/journal/memory.ts`

Pure helpers, no I/O:

```ts
type MemoryType = "user" | "feedback" | "project" | "reference";

interface MemoryEntry { type: MemoryType; body: string; }

// Parse memory.md into per-section bullet lists. Tolerates the
// stub form (just the H1 + intro), arbitrary other top-level
// headings (preserved as-is), and empty sections.
parseMemory(raw: string): {
  preamble: string;          // Everything before the first known section
  sections: Record<MemoryType, string[]>;  // Section bullets in source order
  trailing: string;          // Anything after the last known section (preserved verbatim)
}

// Append entries to the right sections, creating sections that
// don't yet exist. Idempotent if the same entry is already a
// substring of an existing bullet (cheap dedup; the LLM is
// expected to be the primary dedup mechanism).
appendEntries(parsed, entries: MemoryEntry[]): updatedParsed

// Render back to markdown.
renderMemory(parsed): string
```

These helpers stay in their own file so they're trivially unit-testable with golden-file inputs/outputs.

### Archivist contract changes (`archivist.ts`)

- New type `MemoryEntry` exported.
- `DailyArchivistInput` gains `existingMemory: string` (current memory.md content, passed to the LLM as context).
- `DailyArchivistOutput` gains `memoryEntries: MemoryEntry[]` (always present; empty array means "no new facts worth remembering today").
- `DAILY_SYSTEM_PROMPT` extended with a new "MEMORY ENTRIES" section explaining the four types, when to emit (cross-session value), when to skip (one-off chitchat / topical knowledge / facts already in memory.md).
- `buildDailyUserPrompt` includes an "EXISTING MEMORY" block.
- `isDailyArchivistOutput` validates `memoryEntries` is a `MemoryEntry[]`.

### dailyPass orchestration (`dailyPass.ts`)

After `summarize(...)` returns, before/after the existing topic-write loop:

1. Read current `memory.md` via `fsp.readFile`.
2. Pass to archivist as `existingMemory`.
3. On the way back: `parseMemory` → `appendEntries(parsed, output.memoryEntries)` → `renderMemory` → atomic write to `memory.md`.

Skip the write entirely if `memoryEntries` is empty (avoids rewriting the file with identical content every day).

### Backward compatibility

`memoryEntries` is **required** in the new schema. Older archivist responses (without the field) would fail validation. We don't have any persisted output to migrate — the archivist is invoked fresh every run — so there's nothing to migrate. Tests cover a "model returns empty array" case so we know the happy path with zero entries works.

## Tests

- `test/journal/test_memory.ts` — `parseMemory` (stub form, full form, sections out of order, unknown headings preserved) / `appendEntries` (creates missing sections, dedup short-circuit) / `renderMemory` round-trip.
- `test/journal/test_archivist.ts` extension — JSON validation accepts a memoryEntries array, rejects malformed members.
- `test/journal/test_dailyPass.ts` extension — golden test: given a fixture day with archivist returning a few memory entries, `memory.md` is updated correctly. Empty-array case: file is **not** rewritten.

## Quality / safety

- All writes go through the existing atomic-write pattern in `dailyPass.ts` (tmp file + rename if applicable; otherwise `fsp.writeFile` is fine because the daily pass holds a lock).
- memory.md preamble + trailing content (anything outside the four known sections) is preserved verbatim — the user can still hand-edit between auto-runs without losing changes.
- LLM-side errors (malformed JSON, missing field) fall back to "skip the memory step", same pattern the existing topic loop uses.

## Phase 2 follow-up

- **memory.md optimization pass** — monthly, mirrors `optimizationPass.ts`: ask the LLM to merge / archive stale entries, drop duplicates, etc.
- **memory-archive.md** — pruned entries land here so nothing is ever truly lost.

## File map

```text
server/journal/
  memory.ts          ← NEW: pure parse / append / render
  archivist.ts       ← extend types + prompt + validator
  dailyPass.ts       ← read+write memory.md around archivist call

test/journal/
  test_memory.ts     ← NEW
  test_archivist.ts  ← extend (memoryEntries validation)
  test_dailyPass.ts  ← extend (golden integration)
```

## Estimated size

400-500 lines code + 200 lines tests.
