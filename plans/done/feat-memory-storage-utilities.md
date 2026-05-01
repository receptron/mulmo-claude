# Memory storage utilities (PR-A of #1029)

Implements the storage layer for typed memory entries — schema, IO, and
migration — but does NOT wire it into runtime yet. The wiring + agent
prompt change ships atomically as PR-B so the workspace never sits in a
half-migrated state where read and write disagree.

## Scope (this PR)

- `server/workspace/memory/types.ts` — schema types and frontmatter shape.
- `server/workspace/memory/io.ts` — load all entries, write entry, regenerate index.
- `server/workspace/memory/migrate.ts` — split existing `memory.md` into typed files. Library only; not invoked by `workspace.ts` yet.
- `server/workspace/memory/paths.ts` — local path constants (mirrors `journal/paths.ts`).
- Add `memoryDir` / `memoryIndex` keys to `WORKSPACE_DIRS` / `WORKSPACE_FILES` / `WORKSPACE_PATHS` so PR-B can wire without further plumbing.
- Tests under `test/workspace/memory/`.

## Out of scope

- `workspace.ts` calling migration on first start → PR-B
- `server/agent/prompt.ts` read/write side update → PR-B (atomic with migration)
- Index auto-regeneration on file change (human edit drift) → phase 2
- `/memory` UI route → #1032
- Expiration / archive → #1033
- Tag-based loading → #1034
- Proactive recall → #1035

## Schema

Each entry is a markdown file with YAML frontmatter:

```yaml
---
name: yarn を使う
description: パッケージマネージャは yarn 固定（npm 不可）
type: preference
---
本文（markdown）…
```

`type` ∈ `preference | interest | fact | reference`.

Filename convention: `<type>_<slug>.md`. Convention is for ergonomics —
`type` in frontmatter is the source of truth. Reader must not depend on
filename for type.

`MEMORY.md` is an index, one line per entry:

```
- [yarn を使う](preference_yarn.md) — npm 不可
- [印象派](interest_impressionism.md) — 美術鑑賞の主軸
```

Index is fully derived from the live frontmatters and **overwritten in
place** on every `regenerateIndex` call. Humans edit individual entry
files (frontmatter is the source of truth); `MEMORY.md` is system-owned
and not user-editable. Hand-written prefix/suffix content is not
preserved.

## IO surface (initial)

```ts
loadAllMemoryEntries(root: string): Promise<MemoryEntry[]>
writeMemoryEntry(root: string, entry: MemoryEntry): Promise<string>  // returns relative path written
regenerateIndex(root: string): Promise<void>                          // rebuilds MEMORY.md from current files
```

Reader silently skips files that fail frontmatter parse (logs once per
file) so a corrupt entry doesn't kill the whole load.

Writer goes through `writeFileAtomic` with `uniqueTmp: true`.

## Migration

`migrateLegacyMemory(root: string, llm: TypeClassifier): Promise<MigrationResult>`

1. Read `conversations/memory.md`. If absent → no-op.
2. Split by `^## ` (H2 headings).
3. For each bullet-line entry under each H2: ask the LLM "is this preference / interest / fact / reference?" via the classifier callback.
4. Write each entry as a typed file under `conversations/memory/`.
5. Rebuild `MEMORY.md`.
6. Rename `memory.md` → `memory.md.backup`. Backup file is never deleted.

`MigrationResult` carries counts (entries written per type, lines skipped, errors). Caller logs.

The classifier is injected so tests can use a stub. The real
implementation in PR-B will reuse the prompt from
`journal/memoryExtractor.ts`.

## Tests (added in this PR)

- `test_io.ts`
  - parse round-trip: write entry → read back → fields match
  - missing frontmatter: file skipped, others still loaded
  - regenerateIndex: index reflects every entry, sorted by type then name
- `test_migrate.ts`
  - golden: fixture memory.md → expected per-type files
  - empty memory.md: no-op
  - missing memory.md: no-op
  - typeClassifier returning `null`: entry skipped + counted
  - backup file is created with original contents

## Followups (PR-B and beyond)

- PR-B wiring (separate plan file)
- Index auto-regeneration on `conversations/memory/*.md` writes (covers human edits via file explorer; needed once #1032 lands)
- Reader caching if the file count grows large
