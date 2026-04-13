# feat: persist tool calls/results in session jsonl + save WebSearch to workspace/searches/ (#194)

## Motivation

Built-in Claude tools (WebSearch / WebFetch / Read / Write / Edit / Bash / Glob / Grep) emit `tool_call` and `tool_call_result` events over the agent stream but those events are never persisted — they only live in the browser's memory. Debugging, knowledge retention, and "look up that search I did last week" use cases need them referenceable after the session ends.

Design decision (per #194): **persist to session jsonl, but store pointers to real files for large payloads instead of inlining bytes**. Specifically:

- WebSearch results → saved as `workspace/searches/YYYY-MM-DD/<slug>-<hash>.md`; jsonl entry carries only `contentRef`.
- Image-producing tools → already save to `workspace/images/`; jsonl entry carries `contentRef`, no base64 in jsonl.
- Tools that reference an existing file (Read, Edit, Write) → jsonl carries `contentRef = args.file_path`.
- Ephemeral tools (Bash, Grep, small WebFetch) → inline `content`, truncated with a `truncated: true` flag if over threshold.

## Design

### Module layout

```
server/tool-trace/
  classify.ts       — pure: (toolName, args, content) → { kind, contentRef, content, truncated }
  writeSearch.ts    — pure slug/path + thin I/O wrapper for saving searches/
  index.ts          — recordToolEvent(sessionId, event) driver; called from routes/agent.ts
```

Tests mirror under `test/tool-trace/`.

### `classify.ts` (pure, heavily tested)

```ts
export type Classification =
  | { kind: "pointer"; contentRef: string }
  | { kind: "inline"; content: string; truncated: boolean };

export function classifyToolResult(
  toolName: string,
  args: unknown,
  content: string,
): Classification;
```

Rules (in priority order):

1. **WebSearch** → `{ kind: "pointer", contentRef }` — the driver writes the result file first, passes the ref in.
2. **Read / Edit / Write** — if `args.file_path` is a string, `{ kind: "pointer", contentRef: normalizeWorkspacePath(args.file_path) }`. Otherwise inline-truncated.
3. **Image-generating MCP tools** — detect by toolName (`generateImage`, `editImage`) + presence of saved path in content → pointer. Otherwise inline-truncated.
4. **Everything else (Bash, Grep, Glob, WebFetch, etc.)** — inline with truncation at `MAX_INLINE_CONTENT_CHARS = 4096`.

A truncated content block records `{ content: content.slice(0, MAX), truncated: true }`.

The function is **pure and synchronous** — tests feed in crafted args/content and assert the classification decision without any filesystem.

### `writeSearch.ts`

Handles the WebSearch side-effect:

```ts
export interface SearchFileInputs {
  query: string;           // from tool_call args
  resultBody: string;      // from tool_call_result content
  sessionId: string;       // chatSessionId
  ts: Date;                // event timestamp
  workspaceRoot: string;
}

// Returns the workspace-relative path the search was saved to.
export async function writeSearchResult(
  inputs: SearchFileInputs,
): Promise<string>;
```

- Path: `searches/YYYY-MM-DD/<slug>-<hash8>.md` where slug comes from the query (existing `slugify` helper) and `hash8` is the first 8 chars of a sha256 over `query + sessionId + ts` to avoid collisions.
- Content: YAML frontmatter (`query`, `sessionId`, `ts`) + `# Search: <query>` heading + result body.
- The pure parts (slug computation, path computation, content template) are exported for unit tests; the I/O is a thin wrapper.

### `index.ts` (driver)

```ts
export interface ToolCallEvent {
  type: "tool_call";
  toolUseId: string;
  toolName: string;
  args: unknown;
}

export interface ToolCallResultEvent {
  type: "tool_call_result";
  toolUseId: string;
  content: string;
}

export interface RecordToolEventDeps {
  workspaceRoot: string;
  chatSessionId: string;
  sessionId: string;                 // internal SSE session for logging only
  resultsFilePath: string;           // chat/<chatSessionId>.jsonl
  now?: () => Date;
  // Cache from tool_call → tool_call_result lookup so we have the
  // args available when the result arrives.
  argsCache: Map<string, { toolName: string; args: unknown }>;
}

export async function recordToolEvent(
  event: ToolCallEvent | ToolCallResultEvent,
  deps: RecordToolEventDeps,
): Promise<void>;
```

- `tool_call` → append a jsonl record and cache args under `toolUseId`.
- `tool_call_result` → look up the cached call (for the `toolName` + `args`), classify, potentially call `writeSearchResult` first, then append a jsonl record with either `contentRef` or `content` + `truncated`.
- All failures are caught and `log.warn("tool-trace", ...)` — driver never throws back into the agent loop.

### Wire-up in `server/routes/agent.ts`

In the `for await (event of runAgent(...))` loop, after `send(event)`:

```ts
if (event.type === "tool_call" || event.type === "tool_call_result") {
  recordToolEvent(event, {
    workspaceRoot,
    chatSessionId,
    sessionId,
    resultsFilePath,
    argsCache,
  }).catch((err) =>
    log.warn("tool-trace", "recordToolEvent failed", { error: String(err) }),
  );
}
```

`argsCache` is declared inside the handler (one per turn) so cross-turn toolUseIds don't collide and memory is released at turn end.

### jsonl record shape (append-only additions)

```jsonl
{"source":"tool","type":"tool_call","toolUseId":"<id>","toolName":"WebSearch","args":{"query":"..."},"ts":"..."}
{"source":"tool","type":"tool_call_result","toolUseId":"<id>","contentRef":"searches/2026-04-13/foo-abc12345.md","ts":"..."}
{"source":"tool","type":"tool_call_result","toolUseId":"<id>","content":"first-4k-chars","truncated":true,"ts":"..."}
```

Existing `source: "user" / "assistant" / "tool"` semantics preserved; only new record types `tool_call` and `tool_call_result` are introduced. Any other server code that reads jsonl continues to see them as unknown types and skip (`server/routes/sessions.ts` already filters unknown entry types gracefully — verify & extend passthrough if needed).

### Session loader (`server/routes/sessions.ts`)

Minimal change: pass tool_call and tool_call_result entries through unchanged. Optionally, if we're feeling fancy, annotate pointer entries with a `refExists: boolean` flag so the frontend can grey-out dead pointers. Defer that polish to a follow-up.

## Tests

`test/tool-trace/`:

1. **`test_classify.ts`** (~15 cases) — pure, no I/O
   - WebSearch → pointer (feeding in a precomputed ref)
   - Read with file_path → pointer to that path
   - Edit with file_path → pointer
   - Write with file_path → pointer
   - generateImage result containing image path → pointer
   - Bash short output → inline, not truncated
   - Bash long output → inline, truncated at MAX chars
   - Grep → inline
   - WebFetch under threshold → inline
   - WebFetch over threshold → truncated
   - unknown tool → inline default
   - Read with non-string file_path → inline fallback
   - Empty content → inline empty string
   - Exactly at threshold → inline, not truncated (boundary)
   - One over threshold → inline, truncated (boundary)

2. **`test_writeSearch.ts`** — tmp dir
   - Produces YYYY-MM-DD directory
   - Slug generated from query via existing slugify
   - Hash deterministic from (query, sessionId, ts) → same inputs → same filename
   - Different inputs → different hash
   - Frontmatter contains query, sessionId, ts
   - Body below frontmatter equals raw result
   - Two searches same day → separate files

3. **`test_index.ts`** — tmp dir, full pipeline
   - tool_call recorded and args cached
   - matching tool_call_result writes pointer for WebSearch
   - matching tool_call_result writes contentRef for Read args
   - matching tool_call_result writes inline (truncated if needed) for Bash
   - orphan tool_call_result (no prior call in cache) → still writes a best-effort entry
   - error in writeSearch → log.warn, fallback to inline truncated

## Rollout

1. Branch `feat/tool-trace-persistence` ✅
2. Plan (this file) ✅
3. Implement `classify.ts` + tests
4. Implement `writeSearch.ts` + tests
5. Implement `index.ts` driver + tests
6. Wire into `routes/agent.ts`
7. Verify `routes/sessions.ts` loader passes new entries through
8. Quality gates (format / lint / typecheck / build / test / test:e2e)
9. Manual smoke: do a turn with WebSearch + Bash + Read and confirm jsonl + searches/ file content
10. Commit by concern, open PR

## Open questions / deferred

- **Existing sessions**: do we want to replay tool events on reload? Phase 2. The frontend already renders MCP tool_results; built-in tool events would need similar UI surfacing. Keep it in a separate issue after persistence lands.
- **Retention**: no cleanup / rotation of `searches/` yet. Workspace is the database — user-managed. Could add to journal optimization pass later.
- **Compression**: no. Markdown stays plain text.
- **Cross-references**: searches/<file>.md is free-standing. Could optionally ingest into `wiki/sources/` — but that's editorial, not automatic.
