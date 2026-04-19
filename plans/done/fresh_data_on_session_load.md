# Fresh Data on Session Load

## Problem

When a user opens a todo list (or scheduler, wiki, etc.) and modifies it during a chat session, the changes work fine in real-time. But when the user navigates to another session and comes back, the plugin views show **stale data from the stored tool result** instead of the current state on disk.

### Root Cause

Tool results are persisted in JSONL files (`chat/{sessionId}.jsonl`). When a session is reopened, `GET /api/sessions/:id` reads the JSONL and returns the tool results as-is. Plugin view components (`View.vue`, `Preview.vue`) render from `props.selectedResult.data` — i.e., the snapshot captured when the tool was originally called.

Meanwhile, the actual data lives on disk (`todos/todos.json`, `scheduler/items.json`, wiki pages, custom roles) and may have been modified by other sessions or direct UI interactions.

### Precedent

`presentMulmoScript` already solves this at the server level: `GET /api/sessions/:id` re-reads the script file from disk for any `presentMulmoScript` tool result before returning it. However, this approach puts the re-read logic in the session loader, which doesn't scale well as plugins grow.

## Affected Plugins

| Plugin | Storage file | View reads from |
|--------|-------------|-----------------|
| `manageTodoList` | `todos/todos.json` | `props.selectedResult.data.items` |
| `manageScheduler` | `scheduler/items.json` | `props.selectedResult.data.items` |
| `manageWiki` | `wiki/*.md` files | `props.selectedResult.data.{action,title,content,pageEntries}` |
| `manageRoles` | `roles/custom_roles.json` | `props.selectedResult.data.customRoles` |

**Not affected:**
- `presentMulmoScript` — already re-reads from disk at session load time
- `presentHtml` — generated content, showing the historical snapshot is correct
- `textResponse` — conversation text, historical snapshot is correct

## Solution: Client-Side Fetch on Mount

Instead of adding per-plugin re-read logic to the session loader (the `presentMulmoScript` approach), each affected plugin's **View.vue** and **Preview.vue** should fetch fresh data from disk when they mount.

### Changes Required

#### 1. Add GET endpoints to each plugin's server route

Each plugin already has a POST endpoint for mutations. Add a simple GET that returns the current state from disk.

| Route file | New endpoint | Returns |
|-----------|-------------|---------|
| `server/api/routes/todos.ts` | `GET /api/todos` | `{ data: { items } }` |
| `server/api/routes/scheduler.ts` | `GET /api/scheduler` | `{ data: { items } }` |
| `server/api/routes/wiki.ts` | `GET /api/wiki?action=index` | `{ data: { pageEntries } }` |
| `server/api/routes/roles.ts` | `GET /api/roles` | `{ data: { customRoles } }` |

The GET response shape should match the POST response `data` field so the same component code can consume both.

#### 2. Update View.vue components

For each affected plugin:

```
- Replace: const items = computed(() => props.selectedResult.data?.items ?? [])
- With:    a local reactive ref initialized from props, then overwritten by onMounted fetch
```

Pattern:

```typescript
import { ref, onMounted } from "vue";

const items = ref<TodoItem[]>(props.selectedResult.data?.items ?? []);

onMounted(async () => {
  try {
    const res = await fetch("/api/todos");
    if (res.ok) {
      const json = await res.json();
      items.value = json.data?.items ?? [];
    }
  } catch {
    // Fall back to prop data (already set)
  }
});
```

This way:
- Initial render uses the prop data (no flash of empty state)
- Fresh data replaces it immediately on mount
- If the GET fails, stale data is still shown (graceful degradation)

#### 3. Update Preview.vue components

Same pattern as View.vue — fetch on mount and override prop data. Preview components are simpler and just need the items/entries list.

#### 4. Update updateResult flow

When the user interacts with the view (toggle todo, delete scheduler item, etc.), the existing `callApi()` → `emit("updateResult")` flow continues to work. The only change is that `items` is now a `ref` instead of a `computed` from props, so `callApi` should update the local ref directly in addition to emitting.

Updated pattern for `callApi`:

```typescript
async function callApi(body: Record<string, unknown>) {
  const response = await fetch("/api/todos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) return; // handle error
  const result = await response.json();
  items.value = result.data?.items ?? [];
  emit("updateResult", {
    ...props.selectedResult,
    ...result,
    uuid: props.selectedResult.uuid,
  });
}
```

## Plugin-Specific Notes

### Wiki

Wiki is slightly different — its view shows either an index (list of pages) or a single page's content. The GET endpoint should support both:
- `GET /api/wiki` → returns page index
- `GET /api/wiki?slug=page-name` → returns page content

The View.vue should fetch based on the current `action` from the tool result (`"index"` vs `"page"`).

### ManageRoles

ManageRoles has a `GET /api/roles` endpoint already (check if it exists). If not, add one that returns the current custom roles from disk.

## File Change Summary

| File | Change |
|------|--------|
| `server/api/routes/todos.ts` | Add `GET /api/todos` |
| `server/api/routes/scheduler.ts` | Add `GET /api/scheduler` |
| `server/api/routes/wiki.ts` | Add `GET /api/wiki` (if not present) |
| `server/api/routes/roles.ts` | Add `GET /api/roles` (if not present) |
| `src/plugins/todo/View.vue` | Fetch on mount, use local ref |
| `src/plugins/todo/Preview.vue` | Fetch on mount, use local ref |
| `src/plugins/scheduler/View.vue` | Fetch on mount, use local ref |
| `src/plugins/scheduler/Preview.vue` | Fetch on mount, use local ref |
| `src/plugins/wiki/View.vue` | Fetch on mount, use local ref |
| `src/plugins/wiki/Preview.vue` | Fetch on mount, use local ref |
| `src/plugins/manageRoles/View.vue` | Fetch on mount, use local ref |
| `src/plugins/manageRoles/Preview.vue` | Fetch on mount, use local ref |

## Out of Scope

- Removing the `presentMulmoScript` re-read logic from `server/api/routes/sessions.ts` — can be done as a follow-up to keep this change focused
- Real-time sync across multiple open tabs/sessions — out of scope for now
