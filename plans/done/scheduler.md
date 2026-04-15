# Scheduler Plugin — Plan

## Overview

A scheduler plugin that lets the LLM manage a list of scheduled items. Modeled after the todo plugin but with **dynamic properties** per item — the LLM can store any key/value metadata it finds relevant (e.g. date, time, location, description, recurrence, priority).

---

## Data Model

Each scheduled item has a fixed identity envelope plus an open `props` bag:

```ts
interface ScheduledItem {
  id: string;          // "sched_<timestamp>_<random>"
  title: string;       // required, human-readable label
  createdAt: number;   // unix ms
  props: Record<string, string | number | boolean | null>;
}
```

**`props` examples**:
```json
{ "date": "2026-04-01", "time": "14:00", "location": "Zoom" }
{ "date": "2026-04-05", "recurrence": "weekly", "priority": "high" }
{ "date": "2026-04-10", "description": "dentist appointment" }
```

The LLM decides which props to set — the schema intentionally does not constrain them.

Storage: `workspace/scheduler/items.json` (JSON array of `ScheduledItem[]`).

---

## Tool Definition

Tool name: `manageScheduler`

Actions:

| Action    | Required params      | Optional params        | Description                               |
|-----------|----------------------|------------------------|-------------------------------------------|
| `show`    | —                    | —                      | Return all items                          |
| `add`     | `title`              | `props`                | Create a new item                         |
| `delete`  | `id`                 | —                      | Remove item by id                         |
| `update`  | `id`                 | `title`, `props`       | Replace title and/or merge props          |
| `replace` | `items`              | —                      | Overwrite entire list (used by UI editor) |

`update` **merges** props (patch semantics) — pass `null` for a key to remove it.
`replace` is called only by the View's JSON editor, not exposed in the LLM tool definition.

---

## Files to Create

### Backend
- `server/routes/scheduler.ts` — Express router for `POST /api/scheduler`

### Plugin
- `src/plugins/scheduler/index.ts` — `ToolPlugin` definition + types
- `src/plugins/scheduler/View.vue` — canvas view (list of items with props)
- `src/plugins/scheduler/Preview.vue` — sidebar thumbnail

### Register
- `src/tools/index.ts` — add `manageScheduler: schedulerPlugin`
- `src/config/roles.ts` — add `"manageScheduler"` to General role's `availablePlugins`
- `server/index.ts` (or wherever routes are mounted) — mount `/api/scheduler`

---

## Backend Logic (`server/routes/scheduler.ts`)

```
POST /api/scheduler
Body: { action, title?, id?, props?, items? }

show           → load and return all items
add            → create item, push, save, return all items
delete         → filter out item by id, save, return all items
update         → find by id, patch title if provided, merge props, save, return all items
replace        → validate items array, overwrite file, return all items
```

Always responds with `{ data: { items }, message, jsonData, instructions, updating: true }`.

---

## View Component (`View.vue`)

Two-panel layout (flex column, full height):

**Top panel — item list (scrollable, flex-1):**
- Header: "Scheduler" + item count
- Empty state: "No scheduled items"
- Each item row:
  - **Title** (bold)
  - Props rendered as `key: value` chips/tags below the title
  - Delete button (hover reveal, calls `/api/scheduler` + emits `updateResult`)

**Bottom panel — JSON source editor (collapsible, flex-shrink-0):**

Modeled after the markdown viewer's `<details>` bottom panel:

- `<details>` element with summary "Edit Source"
- Textarea (monospace, ~40vh) showing the pretty-printed JSON of `items.json`
- Local `editorText` ref keeps the textarea contents
- `isModified` computed: `editorText !== JSON.stringify(items, null, 2)`
- **Apply Changes** button (disabled when unmodified):
  1. Parse `editorText` as JSON — show inline error if invalid
  2. `POST /api/scheduler` with `{ action: "replace", items: parsed }`
  3. On success, emit `updateResult` with the returned result
- Watches `selectedResult.data.items` — resets `editorText` when items change externally (e.g. LLM action)

**New backend action `replace`:**
- Accepts `{ action: "replace", items: ScheduledItem[] }` — validates array shape, overwrites the file, returns full result as usual

---

## Preview Component (`Preview.vue`)

- Filters items to those with a `date` prop ≥ today, plus items with no `date` prop
- Sorts by `date` ascending (items without a date go last)
- Shows first 3 from that sorted list, truncated — title + date if present
- "+ N more…" if additional items remain

---

## Key Design Decisions

1. **Dynamic props over fixed schema** — the LLM decides what metadata matters per item; the view renders whatever keys are present generically.
2. **Patch semantics for `update`** — merging props avoids requiring the LLM to re-send all existing props on every edit; pass `null` to explicitly remove a key.
3. **Always return full list** — every response includes the complete `items` array so the canvas always shows current state, consistent with the todo pattern.
4. **id-based operations** — unlike the todo plugin which matches by fuzzy text, scheduler uses explicit `id` for delete/update to avoid ambiguity when items share similar titles.
5. **JSON source editor** — `<details>` panel at the bottom of the view exposes `items.json` as raw, editable JSON. Modeled after the markdown plugin's "Edit Markdown Source" panel. Uses a `replace` action so the user has full control over the data without going through the LLM. Editor resets whenever items change externally so it always reflects the current file state.

---

## Out of Scope (v1)

- Sorting / filtering by date or other props
- Calendar grid view
- Recurring event expansion
- Notifications / reminders
