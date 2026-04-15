# Plan: reduce cognitive complexity in 6 `.vue` functions

Tracks: #175
Implementation: split across 6 small follow-up PRs (NOT this branch)

## Why this plan exists

PR #174 enabled ESLint on `.vue` files for the first time. That surfaced 6 `sonarjs/cognitive-complexity` violations that had been invisible under the old config. The `.vue` override currently demotes that rule to **warn** so CI isn't blocked, but the real goal is to refactor each function below the 15-point threshold and re-raise the rule to **error** for parity with `.ts` / `.js`.

This file is included in PR #174 as documentation; the actual refactoring happens in separate PRs, one per function.

## Target functions, ranked

| # | File | Function | CC | Risk | Unit-testability |
|---|---|---|---|---|---|
| 1 | `src/plugins/spreadsheet/View.vue:567` | `handleTableClick` | **163** | 🔴 high — click target dispatcher with many hidden edge cases (double-click race, border click, header click) | High after split |
| 2 | `src/App.vue:1100` | `sendMessage` | **47** | 🔴 high — every chat message passes here; SSE parsing, abort-controller lifetime, tool result plumbing all mixed | High after pure-helper extraction |
| 3 | `src/plugins/spreadsheet/View.vue:324` | `extractCellReferences` | 32 | 🟠 medium — formula parser, edge cases around quoted strings / nested parens / `$A$1` / sheet refs | 🏆 **highest** — pure, no I/O |
| 4 | `src/plugins/spreadsheet/View.vue:764` | inline `watch(...)` callback | 30 | 🟡 low — DOM highlight sync, visual-only bugs, no data corruption | Medium (need a composable wrapper) |
| 5 | `src/plugins/spreadsheet/View.vue:472` | `saveMiniEditor` | 20 | 🟠 medium — formula vs literal coercion, potential silent data corruption | High after pure-part extraction |
| 6 | `src/plugins/presentMulmoScript/View.vue:1035` | `generateMovie` | 18 | 🟢 low — just over threshold (18 vs 15), mostly try/catch early-return cleanup | Low / medium |

## Why CC > 15 matters (not just a style rule)

Three concrete failure modes show up in functions this large:

1. **Unhandled branch** — the function body grows to the point where no reviewer can hold every input shape in their head. Edge cases slip past QA because nobody realised that path exists.
2. **State-mutation race** — a sequence of `ref` updates around an `await` reads "obvious" linearly but is actually racy if a second invocation lands mid-flight. Easy to hide in a 160-line function, hard to hide in a 20-line one.
3. **Leaky resources** — a `try { ... } catch { ... }` at the outer level misses an early `return` inside an inner `if`, skipping the `finally` and leaving an `AbortController` / `EventSource` / timer leaked.

`sendMessage` and `handleTableClick` are near-certain to have one or more of the above hiding inside them — splitting is the fix, and unit tests on the extracted helpers are what prove the fix.

## Implementation strategy

### Pattern for every function below

Each refactor follows the same three-step recipe:

1. **Identify pure sub-operations** — the parts that take data in and return data out, with no `ref.value = ...` or DOM access. Move these into `src/plugins/<name>/utils/<concept>.ts` (or similar). Export them.
2. **Add table-driven tests** — mirror `test/routes/test_filesRoute.ts`'s style. Happy path, edge cases, corner cases, empty, malformed, boundary. See CLAUDE.md's Testing section for the mandated coverage patterns.
3. **Replace inline logic with calls to the extracted helpers** — the main function now reads like a top-level narrative and its cognitive complexity drops below 15.

### Per-function split sketch

#### 3. `extractCellReferences` (easiest — start here)

```
spreadsheet/
  utils/
    parseFormula.ts          ← extracted pure parser
      - tokeniseFormula(src)
      - parseCellRef(token)
      - parseRangeRef(token)
      - extractCellReferences(formula) → calls the three above
  View.vue                   ← imports extractCellReferences from utils/
```

Tests: tokenise edge cases (`$A$1`, `Sheet1!A1:B2`, `'With Space'!A1`, quoted literals containing `(`), range expansion, nested parens, empty input, malformed input.

#### 6. `generateMovie` (warm-up — small fix)

Straight-line flow with two bail-outs. Extract the response-parsing step into a pure helper; keep the fetch + abort + status-setting in the caller. Tests cover the parser only.

#### 5. `saveMiniEditor`

Extract:
- `coerceCellValue(raw, targetType)` → pure
- `applyCellEdit(sheets, cellPos, value)` → pure
Main function keeps only `ref` reads, validation calls, and `ref` writes.

#### 2. `sendMessage`

Extract:
- `parseSSEChunk(chunk)` → pure, returns discriminated union
- `resolveActiveSession(state, roleId)` → pure
- `buildRequestPayload(message, history)` → pure
Main function becomes: abort previous → resolve session → build payload → call fetch → loop over parsed SSE chunks → dispatch to handlers.

The `await fetch` / SSE streaming stays in the main function — that's the actual I/O and shouldn't be in a pure helper.

#### 4. Spreadsheet watch callback

Extract into a composable:

```ts
// src/plugins/spreadsheet/composables/useCellHighlighter.ts
export function useCellHighlighter(params) { ... }
```

Tests: the composable's reactive pieces can be tested with a minimal Vue test harness, or split further into a pure `computeHighlightDelta(prev, next)` that's trivially testable.

#### 1. `handleTableClick` (last — biggest)

Event dispatcher split by click target:

- `handleCellClick(td)`
- `handleHeaderClick(th)`
- `handleBorderClick(evt)`
- `handleDoubleClick(td)` — the race-prone case, deserves its own function + test

`handleTableClick` becomes a ~10-line switch on `event.target.tagName` / class.

## PR order and sequencing

Recommended landing order (one PR each):

| # | Function | Why this order |
|---|---|---|
| 1 | `extractCellReferences` | Pure parser, easiest, establishes the testing pattern for the rest |
| 2 | `generateMovie` | Small warm-up; barely over threshold |
| 3 | `saveMiniEditor` | Modest size, introduces `coerceCellValue` helper that might be reusable |
| 4 | `sendMessage` | Critical path, big impact, needs more care |
| 5 | Spreadsheet watch callback | Composable extraction pattern, visual-only fallback |
| 6 | `handleTableClick` | Biggest and highest risk — do last, with all prior patterns available to lean on |

## Done criteria

For the overall effort (across all PRs):

- [ ] All 6 functions have CC ≤ 15
- [ ] Each extracted pure helper has table-driven unit tests covering happy / edge / corner / empty / malformed cases (per CLAUDE.md's Testing requirements)
- [ ] `eslint.config.mjs` `.vue` override raises `sonarjs/cognitive-complexity` back to `error`
- [ ] CLAUDE.md's "Linting covers .vue files" note about temporary warn is removed
- [ ] No behavioural regressions (existing tests pass, manual smoke across spreadsheet + chat + presentMulmoScript)

## Out of scope

- Full test coverage of existing `.vue` components. Tests land only for the **extracted helpers**, not the host Vue components themselves (that's the `e2e/` harness's job).
- Refactors to the `.vue` components' reactivity or state management beyond what's needed to hit CC ≤ 15.
- The other `.vue` warn-demoted rules (`sonarjs/slow-regex`, `vue/no-v-html`) — separate follow-up.
