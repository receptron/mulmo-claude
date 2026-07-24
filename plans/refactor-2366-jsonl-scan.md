# refactor: extract the backward session-jsonl scan from agent.ts and server/index.ts

Issue: #2366

## Context

`jscpd` flagged 60 tokens × 2 blocks between the `claudeSessionId` legacy
scan in `server/api/routes/agent.ts` (`readClaudeSessionIdFromSession`)
and `getSessionHistoryForBridge` in `server/index.ts`. Both hand-write the
same skeleton:

1. `content.split("\n").filter(Boolean)`
2. walk **backwards** with a `for (let i = lines.length - 1; i >= 0; i--)`
3. `JSON.parse` inside a `try`, swallow the throw
4. narrow with `isRecord` before touching `.type`

Only the predicate (`claudeSessionId` vs `text`) and the accumulation
(return the first hit vs collect them all) differ.

The `isRecord` step is not incidental — `agent.ts` carries the comment
that explains it:

> `JSON.parse` hands back `any`, so the `.type`/`.id` reads below were
> unchecked — a line of the wrong shape produced whatever it happened to
> hold. Narrow first; a malformed line is skipped either way.

That hardening lives in two copies today, so the next fix of that kind
reaches only one of them.

## What changes

New pure module `server/utils/sessionJsonl.ts` — takes the jsonl **content
string**, never a path, so the file read stays with the caller and the
scan is testable without touching the filesystem:

```ts
type SessionJsonlEntry = Record<string, unknown>;

findLastSessionEntry<T>(content, pick: (entry) => T | undefined): T | undefined
collectSessionEntriesNewestFirst<T>(content, pick: (entry) => T | undefined): T[]
```

Both are thin wrappers over one private generator, `sessionEntriesNewestFirst`,
which owns the split, the reverse walk, the `try`/`catch`, and the `isRecord`
narrowing. The WHY comment moves onto that generator — one copy.

### Two functions, not one with a stop condition

The two call sites differ in return type (`T | undefined` vs `T[]`) and in
whether they can stop early. A single function with a stop flag would make
the find site unwrap a one-element array and the collect site pass a flag it
never varies — both call sites would read as "generic scan, then figure out
what I meant". Two named wrappers over one lazy generator keep each call site
reading as exactly what it does, with the duplicated part still written once.

### Why an explicit `for` loop survives

CLAUDE.md prefers `filter`/`map`/`reduce` over `for`, and `const` over `let`.
A backwards scan with an early exit is the documented exception: writing it as
`.split("\n").reverse().map(parse).find(...)` would parse **every** line of the
transcript even when the match is on the last one, which is exactly the case
`readClaudeSessionIdFromSession` hits. The reverse index loop is confined to
the private generator; because the generator yields lazily, `findLastSessionEntry`
still stops at the first hit, and `collectSessionEntriesNewestFirst` is written
functionally (`[...gen].map(pick).filter(...)`) on top of it.

## Constraints

- **No observable behaviour change.**
  - `agent.ts` still returns the id of the LAST `claudeSessionId` event.
  - `server/index.ts` still collects `text` events newest-first and keeps
    its `source` fallback of `"unknown"`.
  - Blank lines: the old code dropped them with `.filter(Boolean)`; the new
    code drops them because `JSON.parse("")` throws and the line is skipped.
    Same result, one less step.
- `isRecord` becomes unused in both call-site files — drop it from their
  imports rather than leaving a dead symbol.
- No `any`, no `as` casts. `pick` is a typed `(entry: Record<string, unknown>) => T | undefined`.

## Other jsonl scanners (checked, deliberately not folded in)

Three more places parse a session jsonl, but all scan **forwards** and none
share the early-exit/backwards skeleton:

- `server/agent/resumeFailover.ts` → `parseTranscriptEntries` (forward; the
  newest-first walk happens later, over already-parsed entries, with a char budget)
- `server/workspace/chat-index/summarizer.ts` → `extractText` (forward; narrows
  with its own `isJsonlEntry`, not `isRecord`)
- `server/workspace/journal/dailyPass.ts` → `parseJsonlEvents` (forward; carries
  a `maxEvents` cap and its own local `parseJsonlLine`)

Folding those in would change what each one does, not just where it lives, so
they stay out of scope. `dailyPass.parseJsonlLine` is the one genuine primitive
overlap (parse-or-null + `isRecord`) and is worth a follow-up issue.

## Tests

`test/utils/test_sessionJsonl.ts` (node:test + `node:assert/strict`), covering
both exported functions:

- empty string
- only blank lines / whitespace-only lines
- a malformed JSON line between valid ones
- lines whose `type` never matches
- a match on the last line
- a match on the first line
- multiple matches — backwards order wins (find takes the last, collect returns newest-first)
- lines that parse to a **number**, a **string**, and an **array** — the cases
  the `isRecord` guard exists to reject

Mutation check: deleting the `isRecord` narrowing must turn the number/string/array
tests RED. Without that check the guard tests prove nothing.
