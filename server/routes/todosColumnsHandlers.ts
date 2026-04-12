// Pure handlers for status columns used by the file-explorer todo
// view. Same shape as todosHandlers / schedulerHandlers: each function
// takes the current state + an input record and returns either an
// error or the next state. The Express route is responsible for
// loading / saving the underlying JSON files.
//
// Storage layout:
//   workspace/todos/columns.json   ← StatusColumn[]
//
// At least one column must always carry `isDone: true` so completed
// items have somewhere to live and the legacy `completed` boolean has
// something to map to.

import type { TodoItem } from "./todos.js";

export interface StatusColumn {
  id: string;
  label: string;
  // True for the column whose items are considered "completed".
  // Exactly one column should have isDone: true at any given time;
  // remove_column / patch_column rules enforce this.
  isDone?: boolean;
}

export const DEFAULT_COLUMNS: StatusColumn[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "Todo" },
  { id: "in_progress", label: "In Progress" },
  { id: "done", label: "Done", isDone: true },
];

// ── Result types ──────────────────────────────────────────────────

export type ColumnsActionResult =
  | { kind: "error"; status: number; error: string }
  | {
      kind: "success";
      columns: StatusColumn[];
      // Some operations also need to mutate items (e.g. removing a
      // column reassigns its items to another column). When set, the
      // route persists this items array as well.
      items?: TodoItem[];
    };

// ── id slug generation ────────────────────────────────────────────

// Convert a free-text label into a URL-safe id. Lowercased ASCII
// letters/numbers/underscore only; everything else collapses to "_".
// Empty result falls back to "column".
function slugify(label: string): string {
  // Lowercased, with all non-alphanumeric runs collapsed to "_". The
  // single regex pass is intentional: doing the trim separately with
  // a leading/trailing _+ regex is flagged by sonarjs as potentially
  // super-linear, so trim the underscores manually instead.
  let slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_");
  let start = 0;
  let end = slug.length;
  while (start < end && slug.charCodeAt(start) === 95) start++;
  while (end > start && slug.charCodeAt(end - 1) === 95) end--;
  slug = slug.slice(start, end);
  return slug.length > 0 ? slug : "column";
}

// Pick an id that doesn't collide with `existingIds`. Tries the bare
// slug first, then `_2`, `_3`, ... until something is free.
function uniqueId(base: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(base)) return base;
  let n = 2;
  while (existingIds.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

// ── Validation helpers ────────────────────────────────────────────

function findColumn(
  columns: StatusColumn[],
  id: string,
): StatusColumn | undefined {
  return columns.find((c) => c.id === id);
}

function ensureColumnsValid(columns: StatusColumn[]): StatusColumn[] {
  // Guarantee invariants when reading: at least one column, exactly
  // one isDone column, ids are unique. If anything is off, fall back
  // to DEFAULT_COLUMNS rather than try to repair partial state.
  if (columns.length === 0) return [...DEFAULT_COLUMNS];
  const seen = new Set<string>();
  for (const c of columns) {
    if (seen.has(c.id)) return [...DEFAULT_COLUMNS];
    seen.add(c.id);
  }
  const doneCount = columns.filter((c) => c.isDone).length;
  if (doneCount === 0) {
    // Promote the last column to done so the invariant holds.
    const fixed = columns.map((c, i) =>
      i === columns.length - 1 ? { ...c, isDone: true } : c,
    );
    return fixed;
  }
  if (doneCount > 1) {
    // Keep only the first done flag.
    let kept = false;
    return columns.map((c) => {
      if (!c.isDone) return c;
      if (kept) {
        const next: StatusColumn = { id: c.id, label: c.label };
        return next;
      }
      kept = true;
      return c;
    });
  }
  return columns;
}

// Public: load-time normaliser. Use this when parsing columns.json so
// the rest of the system never has to think about invalid shapes.
export function normalizeColumns(raw: unknown): StatusColumn[] {
  if (!Array.isArray(raw)) return [...DEFAULT_COLUMNS];
  const cleaned: StatusColumn[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e["id"] !== "string" || typeof e["label"] !== "string") continue;
    const col: StatusColumn = { id: e["id"], label: e["label"] };
    if (e["isDone"] === true) col.isDone = true;
    cleaned.push(col);
  }
  return ensureColumnsValid(cleaned);
}

// ── Item helpers tied to columns ──────────────────────────────────

// id of the first column flagged isDone. Guaranteed to exist after
// normalizeColumns.
export function doneColumnId(columns: StatusColumn[]): string {
  const done = columns.find((c) => c.isDone);
  return done ? done.id : columns[columns.length - 1]!.id;
}

// id of the first non-done column, used as the default status when
// adding new items. Falls back to the done column if everything is
// somehow flagged done.
export function defaultStatusId(columns: StatusColumn[]): string {
  const open = columns.find((c) => !c.isDone);
  return open ? open.id : doneColumnId(columns);
}

// ── Action handlers ───────────────────────────────────────────────

export interface AddColumnInput {
  label?: string;
  isDone?: boolean;
}

export function handleAddColumn(
  columns: StatusColumn[],
  input: AddColumnInput,
): ColumnsActionResult {
  if (!input.label || input.label.trim().length === 0) {
    return { kind: "error", status: 400, error: "label required" };
  }
  const baseId = slugify(input.label);
  const id = uniqueId(baseId, new Set(columns.map((c) => c.id)));
  const col: StatusColumn = { id, label: input.label.trim() };
  if (input.isDone === true) col.isDone = true;
  // If the new column is flagged done, demote any existing done columns
  // (only one is allowed at a time).
  const next = input.isDone
    ? [...columns.map((c) => ({ ...c, isDone: false })), col]
    : [...columns, col];
  return { kind: "success", columns: next };
}

export interface PatchColumnInput {
  label?: string;
  isDone?: boolean;
}

export function handlePatchColumn(
  columns: StatusColumn[],
  id: string,
  input: PatchColumnInput,
  items: TodoItem[],
): ColumnsActionResult {
  const target = findColumn(columns, id);
  if (!target) {
    return { kind: "error", status: 404, error: `column not found: ${id}` };
  }
  const patched: StatusColumn = { id: target.id, label: target.label };
  if (target.isDone) patched.isDone = true;
  if (typeof input.label === "string" && input.label.trim().length > 0) {
    patched.label = input.label.trim();
  }
  let nextColumns = columns.map((c) => (c.id === id ? patched : c));
  // Toggling done flag is non-trivial: only one column may be done.
  let itemsChanged = false;
  let nextItems = items;
  if (input.isDone === true && !target.isDone) {
    // Promote this column to done; demote everyone else.
    nextColumns = nextColumns.map((c) =>
      c.id === id ? { ...c, isDone: true } : { id: c.id, label: c.label },
    );
    // Sync `completed` for items in the new done column.
    nextItems = items.map((it) =>
      it.status === id ? { ...it, completed: true } : it,
    );
    itemsChanged = true;
  } else if (input.isDone === false && target.isDone) {
    // Refuse to demote the only done column — there must always be one.
    return {
      kind: "error",
      status: 400,
      error: "at least one column must be marked as done",
    };
  }
  return {
    kind: "success",
    columns: nextColumns,
    ...(itemsChanged ? { items: nextItems } : {}),
  };
}

export function handleDeleteColumn(
  columns: StatusColumn[],
  id: string,
  items: TodoItem[],
): ColumnsActionResult {
  if (columns.length <= 1) {
    return {
      kind: "error",
      status: 400,
      error: "cannot delete the last remaining column",
    };
  }
  const target = findColumn(columns, id);
  if (!target) {
    return { kind: "error", status: 404, error: `column not found: ${id}` };
  }
  const remaining = columns.filter((c) => c.id !== id);
  // If we just removed the done column, promote the new last column.
  let nextColumns = remaining;
  if (target.isDone) {
    nextColumns = remaining.map((c, i) =>
      i === remaining.length - 1 ? { ...c, isDone: true } : c,
    );
  }
  const newDoneId = doneColumnId(nextColumns);
  // Reassign orphaned items to the (possibly new) done column if the
  // deleted column was done; otherwise to the new default open column.
  const refugeId = target.isDone ? newDoneId : defaultStatusId(nextColumns);
  let itemsChanged = false;
  const nextItems = items.map((it) => {
    if (it.status !== id) return it;
    itemsChanged = true;
    const updated: TodoItem = { ...it, status: refugeId };
    if (refugeId === newDoneId) updated.completed = true;
    return updated;
  });
  return {
    kind: "success",
    columns: nextColumns,
    ...(itemsChanged ? { items: nextItems } : {}),
  };
}

export function handleReorderColumns(
  columns: StatusColumn[],
  ids: string[],
): ColumnsActionResult {
  if (!Array.isArray(ids)) {
    return { kind: "error", status: 400, error: "ids array required" };
  }
  if (ids.length !== columns.length) {
    return {
      kind: "error",
      status: 400,
      error: "ids must contain every existing column id exactly once",
    };
  }
  const known = new Set(columns.map((c) => c.id));
  const seen = new Set<string>();
  for (const id of ids) {
    if (!known.has(id) || seen.has(id)) {
      return {
        kind: "error",
        status: 400,
        error: "ids must contain every existing column id exactly once",
      };
    }
    seen.add(id);
  }
  const byId = new Map(columns.map((c) => [c.id, c]));
  const next = ids.map((id) => byId.get(id)!);
  return { kind: "success", columns: next };
}
