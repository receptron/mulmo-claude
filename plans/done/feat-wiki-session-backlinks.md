# feat: wiki session backlinks (#109)

## Motivation

When a chat session creates or updates a wiki page, the user should be able to jump back from that page to the originating conversation in one click. PR #107 already established `/chat/<id>.jsonl` links (and the FilesView click handler that routes them to the sidebar). This adds the backlinks themselves.

## Constraint (from current code state)

Wiki pages are **not** written through `/api/wiki` — that route is read-only (`index` / `page` / `log` / `lint_report`). Pages live as `wiki/pages/<slug>.md` and are authored by the LLM using Claude Code's built-in `Write` / `Edit` file tools. So the hook cannot sit in the wiki route.

## Design

### Post-turn mtime-based pass

Non-invasive, fire-and-forget, same pattern as `maybeRunJournal` / `maybeIndexSession`:

1. Record `turnStartedAt = Date.now()` when `/api/agent` accepts a request.
2. At the `finally` of the same route, kick off `maybeAppendWikiBacklinks({ chatSessionId, turnStartedAt, ... })`.
3. The driver scans `wiki/pages/*.md` for files with `mtime >= turnStartedAt`, reads each, runs the pure update function, and writes back — only if the content actually changed.

### Module layout

```
server/wiki-backlinks/
  sessionBacklinks.ts   — pure function (dedupe + append)
  index.ts              — mtime-scan driver, fire-and-forget entry point
```

### Pure function contract

```ts
export function updateSessionBacklinks(
  existingContent: string,  // full current page content
  sessionId: string,        // chatSessionId to append
  linkHref: string,         // e.g. "../../chat/<id>.jsonl"
): string;
```

- If content already has the marker and the sessionId is already listed, return `existingContent` unchanged (idempotent).
- If content has the marker but the sessionId is new, append one bullet under the existing `## History` list.
- If content has no marker, append `\n\n<!-- marker -->\n## History\n\n- [session <short>](<linkHref>)\n` at the end.
- Marker: `<!-- journal-session-backlinks -->`.
- Link text: `session <first-8-chars-of-sessionId>` (readable; full UUID is in the href for navigation).
- Parsing existing appendix is done via `indexOf` + bracket/paren scan — **no regex** (aligns with `linkRewrite.ts` style, keeps `sonarjs/slow-regex` quiet).

### Driver contract

```ts
export async function maybeAppendWikiBacklinks(opts: {
  chatSessionId: string;
  turnStartedAt: number;
  workspaceRoot?: string;
  // Optional: skip sessions still being written by another concurrent turn.
  // Current implementation is single-session so this is informational.
  activeSessionIds?: ReadonlySet<string>;
  // Test hook: inject fake `readdir`/`stat`/`readFile`/`writeFile`.
  deps?: Partial<WikiBacklinksDeps>;
}): Promise<void>;
```

- Scans `<workspaceRoot>/wiki/pages/` for `.md` files.
- A page qualifies if `stat().mtimeMs >= turnStartedAt - TOLERANCE_MS` (small tolerance for filesystem mtime granularity).
- Reads, applies pure function, writes back iff content changed.
- All errors are caught and log.warn'd with the `wiki-backlinks` prefix — the driver never throws back into the caller.

### Wiring

```ts
// server/routes/agent.ts finally{}
maybeAppendWikiBacklinks({
  chatSessionId,
  turnStartedAt: requestStartedAt,
  activeSessionIds: getActiveSessionIds(),
}).catch((err) =>
  log.warn("wiki-backlinks", "unexpected error", { error: String(err) }),
);
```

### Tests

`test/wiki-backlinks/`:

- `test_sessionBacklinks.ts` — pure function, ~15 cases:
  - no existing marker → appendix created
  - marker + same sessionId already listed → idempotent
  - marker + different sessionId → second bullet appended
  - marker + many existing sessions → order preserved, new appended last
  - empty existing content → creates appendix on empty base
  - content with trailing newline / no trailing newline
  - multiple markers in input (malformed) → respect first, ignore rest
  - marker present but no bullets → still finds "no existing id" and appends
  - bullet with unexpected text prefix → ignored for dedupe (only parse href)
  - href with query/fragment → gracefully handled
  - sessionId containing only hex (UUID format) → short form uses first 8
  - sessionId shorter than 8 → use full id as short form

- `test_index.ts` — driver, tmp-dir + fake time:
  - page modified after turnStartedAt → backlink appended, file mtime updated
  - page modified before turnStartedAt → skipped
  - no `wiki/pages/` dir → no-op, no error
  - multiple pages, some qualify some don't → only qualifying ones touched
  - file read error → warning logged, other pages still processed
  - content unchanged after pure function (dedupe case) → no write

### Out of scope

- Retroactive backlink reconstruction for pre-existing pages (new create/update grows them naturally).
- Backlinks on other plugin outputs (`wiki/index.md`, `wiki/log.md`, `wiki/sources/`, `markdowns/`, etc.). Separate issue if wanted.
- Propagation to other content roots beyond `wiki/pages/`.

## Rollout

1. Branch `feat/wiki-session-backlinks` ✅
2. Plan ✅
3. Implement pure function + tests
4. Implement driver + tests
5. Wire into `routes/agent.ts`
6. `yarn format && yarn lint && yarn typecheck && yarn build && yarn test && yarn test:e2e`
7. Commit by concern, push, open PR closing #109
