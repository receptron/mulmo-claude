# Bug Fix: Multiple Plugin Results from a Single Prompt

## Problem

When a single user prompt triggers multiple calls to the **same** plugin tool, each new result **replaces** the previous one instead of accumulating. Only the last result is visible in the canvas.

### Test Case

Prompt: *"Perform relevant search on X about OpenAI and Anthropic, pick top ten interesting topics from them and show the list to me. Then, create a presentation about each article, one by one."*

Expected: 10 separate presentation results accumulated in the canvas sidebar.
Actual: Each new presentation overwrites the previous one; only the last is visible.

---

## Root Cause

**Deterministic UUID generation in `server/mcp-server.ts`.**

UUIDs for tool results are generated as `${SESSION_ID}-${toolName}` (line 171). When the same tool (e.g. `presentHtml`) is called multiple times within one agent run, every result gets the **identical** UUID.

On the client side (`src/App.vue`, lines 995-1003), when a `tool_result` SSE event arrives:

```typescript
const existing = session.toolResults.findIndex(
  (r) => r.uuid === result.uuid,
);
if (existing >= 0) {
  session.toolResults[existing] = result;   // ← overwrites!
} else {
  session.toolResults.push(result);
}
```

Because the UUID matches an existing result, the client treats it as an **update** rather than a **new result**.

The same issue affects `manageRoles` at line 130: `uuid: \`${SESSION_ID}-manageRoles\``.

### Why the client dedup exists

The findIndex/replace logic is intentional — some tools legitimately update their result in-place (e.g. a progress indicator). The bug is not in the client logic; it's in the UUID generation being non-unique.

---

## Fix

### `server/mcp-server.ts`

Replace deterministic UUIDs with unique ones using `crypto.randomUUID()` (available natively in Node.js 19+):

**Line 171** — general plugin tool results:
```typescript
// Before
uuid: `${SESSION_ID}-${name}`,

// After
uuid: crypto.randomUUID(),
```

**Line 130** — manageRoles special case:
```typescript
// Before
uuid: `${SESSION_ID}-manageRoles`,

// After
uuid: crypto.randomUUID(),
```

### No client changes needed

The client-side dedup logic in `src/App.vue` is correct as-is. With unique UUIDs:
- Distinct tool calls get distinct UUIDs → pushed as new results
- If a future tool needs in-place updates, it can return a stable UUID explicitly

### No JSONL changes needed

`server/sessions.ts` already appends each tool result as a new line in the session JSONL file. The persistence layer is not affected by the UUID collision — only the live UI state is.

---

## Files to Change

| File | Change |
|---|---|
| `server/mcp-server.ts:171` | `uuid: crypto.randomUUID()` |
| `server/mcp-server.ts:130` | `uuid: crypto.randomUUID()` |

---

## Verification

1. Start dev server with `npm run dev`
2. Use a role that has a visual plugin (e.g. one with `presentHtml`)
3. Give a prompt that triggers the same plugin multiple times (see test case above)
4. Confirm all results appear in the sidebar and can be individually selected
5. Confirm session reload from JSONL still shows all results
