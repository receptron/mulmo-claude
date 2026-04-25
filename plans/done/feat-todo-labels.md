# Feature: labels on todos, with filtering

## Goal

Add optional labels (tags) to todo items so users can categorise tasks
(`Work`, `Groceries`, `Urgent`, …) and filter the list to one or more
labels at read time.

The feature is purely additive at the data layer — existing todos and
their storage file stay valid with zero migration.

## Non-goals

- **Single-label-per-item**: we support multiple labels per item.
- **Global label registry**: labels are derived from the items that exist
  (no separate `labels.json`). When the last item using a label is deleted,
  the label simply disappears from the filter bar.
- **Colour customisation**: label colours are deterministic from a hash of
  the label string against an 8-slot Tailwind palette. Users don't pick.
- **Nested / hierarchical labels**: flat set only. No `Work/Frontend`.
- **Label rename cascades**: rename a label on an item and you're really
  editing that one item. Batch rename is a future follow-up.
- **Sort by label**: filter yes, sort no.
- **Migration tooling**: not needed — `labels?: string[]` is optional, old
  items load as `labels === undefined` (empty).

## Data model

```ts
// server/api/routes/todos.ts and src/plugins/todo/index.ts
export interface TodoItem {
  id: string;
  text: string;
  note?: string;
  labels?: string[];     // NEW: 0+ labels, case preserved as typed
  completed: boolean;
  createdAt: number;
}
```

- Labels are arbitrary strings, trimmed at the helper layer.
- **Storage**: case-preserving ("Work" stays "Work").
- **Matching / deduplication**: case-insensitive (`Work` and `work` are the
  same label for filter and `add_label` semantics).
- Empty string and all-whitespace labels are rejected at the helper layer.
- Duplicate labels within a single item are de-duped on add.

## LLM API (`manageTodoList`)

Existing actions stay, with two that gain new optional parameters, plus
three new actions.

### Extended existing actions

- `add` gains `labels?: string[]`:
  `{ action: "add", text: "Buy milk", labels: ["Groceries"] }`
- `show` gains `filterLabels?: string[]`:
  `{ action: "show", filterLabels: ["Work", "Urgent"] }`
  Semantics: **OR** (returns items that have *any* of the given labels).
  Matching is case-insensitive.

### New actions

- `add_label` — `{ action: "add_label", text: "...", labels: ["Urgent"] }`
  Finds the item by partial text match (same convention as `check` /
  `update`) and unions the new labels into its existing set.
- `remove_label` — symmetrical removal.
- `list_labels` — returns an object listing every label currently in use
  and the number of items carrying it:
  `{ labels: [{ label: "Work", count: 3 }, { label: "Urgent", count: 1 }] }`.
  Results are sorted by count descending, then by label ascending.

### Unchanged behaviour

- `delete` / `check` / `uncheck` / `update` / `clear_completed`: no new
  parameters. `update`'s `text`/`note` contract is unchanged.
- `update` does NOT touch labels. Use `add_label` / `remove_label` for
  label edits — this keeps each LLM call single-purpose.

## Pure helpers

All label logic lives in one new pure file so it's exhaustively
unit-testable without touching filesystem or Vue reactivity.

```ts
// src/plugins/todo/labels.ts

// Normalise a raw user-typed label for storage:
//   - trim leading/trailing whitespace
//   - collapse internal whitespace runs to single spaces
//   - reject empty or whitespace-only → returns null
export function normalizeLabel(raw: string): string | null;

// Return true iff two labels are considered equal (case-insensitive
// after normalization). Used by add_label / remove_label / filter.
export function labelsEqual(a: string, b: string): boolean;

// Deterministic colour class assignment. Hash the label, pick one of
// LABEL_PALETTE. Same label → same colour, every time.
export const LABEL_PALETTE: readonly string[];
export function colorForLabel(label: string): string;

// Client- and server-side filter. `filterLabels` is OR semantics,
// case-insensitive. If `filterLabels` is empty, return `items` unchanged.
export function filterByLabels<T extends { labels?: string[] }>(
  items: readonly T[],
  filterLabels: readonly string[],
): T[];

// Build the "list_labels" output: distinct labels in use + counts,
// sorted by count desc then alpha asc. Case-insensitive grouping; the
// displayed form is the most-frequent case variant of each group.
export function listLabelsWithCount(
  items: readonly { labels?: string[] }[],
): Array<{ label: string; count: number }>;

// Add labels to an existing set without duplicates (case-insensitive).
export function mergeLabels(
  existing: readonly string[],
  adding: readonly string[],
): string[];

// Remove labels from an existing set (case-insensitive match).
export function subtractLabels(
  existing: readonly string[],
  removing: readonly string[],
): string[];
```

### `LABEL_PALETTE` choice

Eight Tailwind pastel classes — enough visual variety without being
garish, consistent with existing MulmoClaude UI tone:

```ts
export const LABEL_PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-green-100 text-green-700",
  "bg-purple-100 text-purple-700",
  "bg-yellow-100 text-yellow-700",
  "bg-pink-100 text-pink-700",
  "bg-indigo-100 text-indigo-700",
  "bg-red-100 text-red-700",
  "bg-teal-100 text-teal-700",
] as const;
```

### Hash for colour

Simple deterministic string hash:

```ts
export function colorForLabel(label: string): string {
  const key = label.toLowerCase();
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return LABEL_PALETTE[hash % LABEL_PALETTE.length];
}
```

Important property: case-insensitive on input so `Work` and `work`
get the same colour even if stored in different items.

## View.vue changes

### Filter bar (new, at the top)

Appears only when at least one label is in use:

```
┌────────────────────────────────────────────────────────────┐
│ Filter:  [ Work ×5 ] [ Urgent ×2 ] [ Groceries ×3 ]  ✕    │
└────────────────────────────────────────────────────────────┘
```

- Each chip is a toggleable button (clicking adds/removes from the
  active filter set).
- Count is from `listLabelsWithCount(items)`.
- `✕` clears all active filters.
- Colours match `colorForLabel`; active filters gain a ring or
  inversion (`bg-blue-700 text-white` instead of `bg-blue-100 text-blue-700`).
- Local state only — not persisted across sessions.

### Item row

Each todo row already has text + note. Labels render as small chips
between the text and the delete button:

```
☐  Buy milk   [Groceries] [Urgent]                    ✕ ▾
```

- Chip colour via `colorForLabel`.
- Chips wrap if there are many on a narrow screen.

### Filtered list

`filteredItems = filterByLabels(items, [...activeFilters])`. The rest of
the existing render logic iterates over `filteredItems` instead of `items`.

The completed counter stays based on the *unfiltered* items, so it
represents the whole list ("5/12 completed") regardless of which filter
the user is viewing. Alternative: filtered counter. Starting with
unfiltered because it's less surprising when filters are toggled.

### Inline YAML editor

Add a `labels:` field. YAML list of strings:

```yaml
text: "Buy milk"
note: ""
labels: [Groceries, Urgent]
```

The existing parser is simplistic; we extend it to handle one more key
with a comma-separated or bracket-delimited list. If parse fails, the
existing error-banner pattern shows.

The edit operation saves via an existing flow — BUT `update` action in
the server doesn't touch labels (decision above). So editing labels from
the YAML editor issues **`add_label` + `remove_label`** as a diff against
the prior state, not a single `update`.

Alternative: extend `update` to accept `labels` and do replace-semantics.
Simpler server side, but asymmetric with LLM ergonomics. I prefer keeping
the LLM's action set narrow and having the View compute the diff.

Actually on reflection: the View can just call both add_label and
remove_label in sequence. If the diff is empty on one side, skip that
call. Two POSTs instead of one is fine.

### `add` flow from user typing

Out of scope for this PR — the current View doesn't have an "add todo"
text field; adds are LLM-driven. If we add a manual add later, labels
would be a natural part of that.

## Preview.vue changes

- Each preview item shows a mini-chip strip of its labels (first 2 labels,
  then `+N` if more). Colours from `colorForLabel`.
- The `+N more…` footer stays as is.
- The `{completedCount}/{items.length} completed` header stays as is.

## Server route changes

### `server/api/routes/todos.ts`

- Add `labels?: string[]` to `TodoItem`.
- Add `filterLabels` and `labels` fields to `TodoBody`:
  ```ts
  interface TodoBody {
    action: string;
    text?: string;
    newText?: string;
    note?: string;
    labels?: string[];       // NEW: for add / add_label / remove_label
    filterLabels?: string[]; // NEW: for show
  }
  ```
- Extend `add` case: set `labels` on the new item if provided, passing
  through `normalizeLabel` + de-dup.
- Extend `show` case: apply `filterByLabels(items, filterLabels ?? [])`
  before building the response.
- Add `add_label` case: find item by text match, call `mergeLabels`.
- Add `remove_label` case: find item by text match, call `subtractLabels`.
- Add `list_labels` case: return `listLabelsWithCount(items)` in `jsonData`.

Server imports the pure helpers from `src/plugins/todo/labels.ts` —
the same file the Vue layer uses. This file is already imported by
other server code (via `src/plugins/*/definition.ts`), so cross-tree
import is precedented in `server/tsconfig.json`'s `include`.

### `src/plugins/todo/definition.ts`

Update the tool schema:

```ts
actions: [
  "show", "add", "delete", "update",
  "check", "uncheck", "clear_completed",
  "add_label", "remove_label", "list_labels",  // NEW
],
parameters: {
  // ... existing
  labels: {
    type: "array",
    items: { type: "string" },
    description:
      "For 'add': labels to tag the new item with. For 'add_label' / 'remove_label': labels to add/remove from the matched item. Labels are case-insensitive for matching but stored with their original case.",
  },
  filterLabels: {
    type: "array",
    items: { type: "string" },
    description:
      "For 'show' only: only return items that have at least one of these labels (case-insensitive). Omit to show all.",
  },
},
```

## Test plan

### Unit tests (`test/plugins/todo/test_labels.ts`)

Covered by the new pure helpers, no filesystem / no Vue:

1. **normalizeLabel**
   - Trims whitespace
   - Collapses internal whitespace runs
   - Rejects empty and whitespace-only (returns null)
   - Preserves case

2. **labelsEqual**
   - Case-insensitive match
   - Normalisation-aware (`" Work "` == `"work"`)

3. **colorForLabel**
   - Deterministic: same input → same output
   - Case-insensitive: `Work` and `work` → same colour
   - Returns a value from `LABEL_PALETTE`
   - Different labels likely → different colours (spot check)

4. **filterByLabels**
   - Empty filter → pass-through
   - Single label → OR semantics (matches any item with that label)
   - Multiple labels → OR semantics (matches items with ANY of them)
   - Case-insensitive
   - Items without `labels` are excluded from non-empty filter

5. **listLabelsWithCount**
   - Counts case-insensitive groups
   - Chooses a consistent display form per group (first seen or
     most-frequent case, document the choice)
   - Sorted by count desc, then label asc
   - Items without labels contribute nothing

6. **mergeLabels**
   - Adds new labels
   - No duplicates when adding an existing label (case-insensitive)
   - Preserves existing order, appends new labels

7. **subtractLabels**
   - Removes matching labels (case-insensitive)
   - Removing a non-existent label is a no-op
   - Preserves order of surviving labels

Roughly 20–25 test cases total.

### No server integration tests in this PR

The server routes wrapping these helpers are thin — the helpers are the
complex bit, and they're fully covered. Route-level tests would require
a test harness we don't have for todos right now.

### Manual smoke (post-merge, noted)

- Add a todo with labels via LLM → labels show in View and Preview
- `add_label` / `remove_label` flows work
- `show` with `filterLabels` narrows the result to only OR-matched items
- `list_labels` returns the expected shape
- View filter bar toggles and clears correctly
- YAML editor shows labels, edits apply as add_label + remove_label diffs

## File changes

| File | Type | Lines (approx) |
|---|---|---|
| `plans/done/feat-todo-labels.md` | new | — (this file) |
| `src/plugins/todo/labels.ts` | new | 80 |
| `server/api/routes/todos.ts` | modified | +90 |
| `src/plugins/todo/definition.ts` | modified | +30 |
| `src/plugins/todo/index.ts` | modified | +1 |
| `src/plugins/todo/View.vue` | modified | +120 |
| `src/plugins/todo/Preview.vue` | modified | +15 |
| `test/plugins/todo/test_labels.ts` | new | 180 |

Total ~515 lines.

## Out of scope / follow-ups

- **Batch label rename**: "rename Work → Office everywhere" is a common
  request that deserves its own action (`rename_label`). Doable after
  this PR lands.
- **Manual "add todo" text field in View**: would be a natural pairing
  with label input but blocks on a broader UI decision. Separate PR.
- **Per-role default label set**: some roles might want to auto-tag
  items (`office` role → auto "Work"). Out of scope.
- **Label suggestion based on item text**: LLM can already do this
  during the `add` call; no extra wiring needed.
- **Sort by label**: filter is enough for v1.

## Risks & mitigations

- **Label name hygiene**: users / LLM may create dozens of near-duplicate
  labels ("work", "Work", "WORK", "ワーク"). Case-insensitive matching +
  the `list_labels` action give the LLM a way to self-audit and
  consolidate with `add_label` / `remove_label`. No automatic dedup.
- **Filter performance**: all operations are O(n) where n is total
  todos. For reasonable list sizes (< 1000 items) this is fine. No
  indexing needed.
- **Filter state lost on session switch**: intentional. Filters are
  view-local, not persisted. Consistent with how MulmoClaude handles
  other transient UI state.
- **LLM inventing labels**: no hard schema — the LLM can tag anything.
  That's the point. If clutter becomes a problem, the rename
  follow-up handles cleanup.
