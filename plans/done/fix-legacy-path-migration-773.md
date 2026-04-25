# Fix: Legacy artifact path migration (#773)

## Problem

Sessions whose JSONL (or other text files) still reference legacy prefixes
(`markdowns/*.md`, `spreadsheets/*.json`) can be **loaded** by the Vue
side but **fail to save** on the server side. Root cause:

| Side | `markdowns/` | `artifacts/documents/` |
|---|---|---|
| Vue `isFilePath` (load) | ✓ accepted | ✓ accepted |
| Server `isMarkdownPath` (save) | ✗ rejected | ✓ accepted |

Result: user opens legacy-path doc → edits → save → 4xx → edits silently
lost. The physical directories were already moved by the #284 migration
(see `~/mulmoclaude/migration-284-manifest.json` — `markdowns → artifacts/documents`,
`spreadsheets → artifacts/spreadsheets`), so this is purely a
text-reference cleanup.

## Strategy

**C++ (improved option C): one-shot migration batch script** that walks the
workspace, rewrites legacy references everywhere, and enables option A
(reject legacy on Vue side) once complete.

Rejected alternatives:
- Option A alone (just reject legacy in Vue): legacy refs would render as
  inline content — confusing, data still broken.
- Option B (accept legacy on server): reintroduces a path #284 retired,
  doesn't push toward canonical.
- Vanilla C (rewrite on session load): runtime overhead, partial coverage,
  hard to audit.

## Plan

### 1. Pure rewriter (`scripts/lib/legacyPaths.ts`)

```ts
export function rewriteLegacyPaths(text: string): string {
  // markdowns/<hex>.md → artifacts/documents/<hex>.md
  // spreadsheets/<hex>.json → artifacts/spreadsheets/<hex>.json
  //
  // Negative lookbehind `(?<![\w/.-])` ensures we don't accidentally
  // rewrite things like `my-markdowns/foo` or `/path/markdowns/bar`.
}

export interface LegacyPathScanResult {
  occurrences: number;
  before: string;
  after: string;
}
```

Pure function, fully unit-testable.

### 2. CLI wrapper (`scripts/migrate-legacy-artifact-paths.ts`)

```bash
npx tsx scripts/migrate-legacy-artifact-paths.ts              # dry-run
npx tsx scripts/migrate-legacy-artifact-paths.ts --write      # apply
npx tsx scripts/migrate-legacy-artifact-paths.ts --root=/path # override workspace
```

Targets: walk the workspace recursively, process:

- `conversations/chat/*.jsonl`
- `conversations/summaries/**/*.md`
- `conversations/summaries/**/*.json`
- `data/wiki/pages/*.md`
- `data/wiki/log.md`
- `memory.md`

Skips:
- Any `*.bak` file
- `migration-*-manifest.json` (historical, don't touch)
- Binary files (images, PDFs)
- `artifacts/` directory (actual files are already at canonical paths;
  references within generated artifact bodies are out of scope — LLM
  will regenerate if needed)

Behavior:
- Atomic writes via `writeFileAtomic` (already exists in server/)
- Idempotent: second run = 0 changes
- Dry-run default; `--write` to actually mutate

### 3. Option A application

Once migration is dry-run-clean on the real workspace, apply option A:
- `src/plugins/markdown/definition.ts:17`: drop `|| value.startsWith("markdowns/")`
- `src/plugins/spreadsheet/View.vue:199`: drop `|| value.startsWith("spreadsheets/")`

Client and server validators are then symmetric.

### 4. Tests

`test/scripts/test_legacyPaths.ts` — exhaustive unit tests for the pure
rewriter:
- Happy path (canonical JSON field value)
- Markdown link `(markdowns/foo.md)`
- Inline code `` `markdowns/foo.md` ``
- Spreadsheet variant
- Idempotency (rewrite twice = rewrite once)
- No-match cases:
  - `my-markdowns/foo` (wrong prefix continuation)
  - `/abs/markdowns/foo` (path continuation)
  - `markdowns/` with no filename
  - `markdowns/foo.txt` (wrong extension)
- Edge: multiple matches in one line
- Edge: match split across JSON field values

## Acceptance

- [ ] `rewriteLegacyPaths()` exported as pure function with full unit
      coverage
- [ ] CLI runs in dry-run by default, shows per-file summary
- [ ] `--write` applies changes atomically, idempotent
- [ ] Dry-run on real workspace shows expected match count (spot-checked
      4 `markdowns/*.md` refs in conversations/chat)
- [ ] After `--write`: dry-run second time shows 0 matches
- [ ] Option A applied: Vue validators drop legacy prefix
- [ ] `yarn format` / `yarn lint` / `yarn typecheck` / `yarn test` clean

## Out of scope

- Rewriting legacy references inside generated artifact bodies
  (e.g. HTML or chart JSON files that happen to mention `markdowns/`);
  these regenerate on edit anyway
- `*.bak` files
- User-defined scripts / notes outside the known workspace layout
- Automatic backup before `--write` (user should commit their workspace
  or keep the `migration-284-manifest.json` backup reference)
