# refactor: dedup the LLM-JSON parsing helpers in `server/workspace/memory`

Issue: #2336

## Context

`jscpd` (Code Scanning `duplication-scan`) flagged the largest non-package
clone in the repo — 326 tokens / 54 lines, byte-identical:

| File                                        | Range   |
| ------------------------------------------- | ------- |
| `server/workspace/memory/llm-classifier.ts` | 104-154 |
| `server/workspace/memory/topic-cluster.ts`  | 167-214 |

Both files own the same responsibility — "parse the JSON-ish text an LLM
returned" — so a parser bug fixed in one would silently stay live in the
other. Both copies are side-effect-free pure functions and neither had a
direct test.

## Approach

1. New `server/workspace/memory/llm-json.ts` holding the three parsing
   helpers, exported so they can be tested directly:
   - `stripFenceAndWhitespace(raw)` — drop a surrounding ``` fence
   - `extractFirstObject(text)` — first balanced `{...}`, skipping string literals
   - `skipStringBody(text, fromIndex)` — advance past a string literal, honouring `\` escapes
2. Both callers import from it. The WHY comments move with the code.
3. New `test/workspace/memory/test_llm_json.ts` (node:test + node:assert).
4. One-line entry in `docs/shared-utils.md` so the next "parse what the LLM
   returned" need finds it instead of writing copy #3.

## Key decision: `isPlainObject` → `isRecord`, not a fourth copy

The issue lists four duplicated functions. The fourth, `isPlainObject`, is
byte-identical to `isRecord` in `@mulmoclaude/common` (re-exported from
`server/utils/types.ts`), which is the repo's single record guard after
#2217 consolidated 40+ inline copies. Moving `isPlainObject` into
`llm-json.ts` would have preserved a duplicate that `docs/shared-utils.md`
explicitly exists to prevent, so both call sites now use `isRecord`
instead and `isPlainObject` is deleted outright. Copies of the guard in
these two files: 2 → 0.

`isRecord` already has object / array / null / primitive coverage in
`packages/common/test/test_guards.ts`, so it is not re-tested here.

Worth noting for a future reader: at both call sites the guard is
defensive-only — `extractFirstObject` only ever returns text starting with
`{`, so `JSON.parse` either throws or yields a plain object. It stays
because the guard is what gives TypeScript the narrowing.

## Tests

`test/workspace/memory/test_llm_json.ts` covers, per the issue:

- `stripFenceAndWhitespace`: unfenced, ` ```json ` fence, bare fence,
  unterminated fence, fence with no newline, empty string, a fence-looking
  run that is not at the start.
- `extractFirstObject`: flat object, nested `{}`, `}` inside a string
  literal, escaped `\"` inside a string, `{` inside a string literal,
  unterminated string, unbalanced object, no `{` at all, leading/trailing
  prose, empty string.
- `skipStringBody`: plain body, escaped quote, escaped backslash before the
  closing quote, unterminated string, `fromIndex` past the end.

## Verification

Mutation check (per CLAUDE.md "verify a fix by reverting it") — three
breakages, each reverted afterwards:

| Mutation                                           | New tests   | `test_llm_classifier` + `test_topic_cluster` |
| -------------------------------------------------- | ----------- | -------------------------------------------- |
| `skipStringBody` returns `fromIndex`               | 6 / 21 fail | 18 / 18 still pass                           |
| `stripFenceAndWhitespace` becomes `raw.trim()`     | 4 / 21 fail | 18 / 18 still pass                           |
| `extractFirstObject` drops the string-literal skip | 2 / 21 fail | 18 / 18 still pass                           |

The right-hand column is the point: the pre-existing tests never exercised
the fence stripper or the string skipping — their "strips a leading code
fence" cases pass with the stripper deleted, because the brace scan finds
the object inside the fence anyway. The extracted helpers had effectively
no coverage before this PR.

Behaviour is otherwise unchanged: all 120 `test/workspace/memory` tests
pass.
