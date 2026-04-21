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

import { hasNonAscii, hashSlug } from "../../utils/slug.js";
import { isRecord } from "../../utils/types.js";
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
// Non-ASCII labels (e.g. Japanese) get a deterministic sha256-based
// id so distinct labels never collapse to the same fallback "column".
function slugify(label: string): string {
  let slug = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_");
  let start = 0;
  let end = slug.length;
  while (start < end && slug.charCodeAt(start) === 95) start++;
  while (end > start && slug.charCodeAt(end - 1) === 95) end--;
  slug = slug.slice(start, end);

  if (!hasNonAscii(label)) return slug.length > 0 ? slug : "column";

  const hash = hashSlug(label.trim());
  if (slug.length >= 3) return `${slug}_${hash}`;
  return hash;
}

// Pick an id that doesn't collide with `existingIds`. Tries the bare
// slug first, then `_2`, `_3`, ... until something is free.
function uniqueId(base: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

// ── Validation helpers ────────────────────────────────────────────

function findColumn(
  columns: StatusColumn[],
  id: string,
): StatusColumn | undefined {
  return columns.find((column) => column.id === id);
}

function ensureColumnsValid(columns: StatusColumn[]): StatusColumn[] {
  // Guarantee invariants when reading: at least one column, exactly
  // one isDone column, ids are unique. If anything is off, fall back
  // to DEFAULT_COLUMNS rather than try to repair partial state.
  if (columns.length === 0) return [...DEFAULT_COLUMNS];
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.id)) return [...DEFAULT_COLUMNS];
    seen.add(column.id);
  }
  const doneCount = columns.filter((column) => column.isDone).length;
  if (doneCount === 0) {
    // Promote the last column to done so the invariant holds.
    const fixed = columns.map((column, i) =>
      i === columns.length - 1 ? { ...column, isDone: true } : column,
    );
    return fixed;
  }
  if (doneCount > 1) {
    // Keep only the first done flag.
    let kept = false;
    return columns.map((column) => {
      if (!column.isDone) return column;
      if (kept) {
        const next: StatusColumn = { id: column.id, label: column.label };
        return next;
      }
      kept = true;
      return column;
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
    if (!isRecord(entry)) continue;
    if (typeof entry["id"] !== "string" || typeof entry["label"] !== "string")
      continue;
    const col: StatusColumn = { id: entry["id"], label: entry["label"] };
    if (entry["isDone"] === true) col.isDone = true;
    cleaned.push(col);
  }
  return ensureColumnsValid(cleaned);
}

// ── Item helpers tied to columns ──────────────────────────────────

// id of the first column flagged isDone. Guaranteed to exist after
// normalizeColumns.
export function doneColumnId(columns: StatusColumn[]): string {
  const done = columns.find((column) => column.isDone);
  return done ? done.id : columns[columns.length - 1]!.id;
}

// id of the first non-done column, used as the default status when
// adding new items. Falls back to the done column if everything is
// somehow flagged done.
export function defaultStatusId(columns: StatusColumn[]): string {
  const open = columns.find((column) => !column.isDone);
  return open ? open.id : doneColumnId(columns);
}

// Reconcile each item's `completed` boolean with the new done-column
// id. Items in the new done column are completed=true, items
// elsewhere are completed=false. Returns [updatedItems, changed]
// where `changed` says whether any item was actually rewritten —
// callers use that to decide whether to persist items along with
// the column change.
//
// This is the *only* place that mass-mutates `completed` based on
// status. The migration on read deliberately does NOT do this any
// more (so the legacy MCP `check` action's plain boolean flips keep
// working). Column operations are explicit user intent so it's safe
// to sync at that point.
export function resyncDoneMembership(
  items: TodoItem[],
  newDoneId: string,
): { items: TodoItem[]; changed: boolean } {
  let changed = false;
  const next = items.map((it): TodoItem => {
    const shouldBeDone = it.status === newDoneId;
    if (it.completed === shouldBeDone) return it;
    changed = true;
    return { ...it, completed: shouldBeDone };
  });
  return { items: next, changed };
}

// Re-stripe order values for every item in `columnId`. Items already
// sorted by their existing `order` get reassigned to 1000, 2000, ...
// so two columns being merged together (handleDeleteColumn's refuge
// case) end up with unique, contiguous orders rather than colliding
// 1000s from each side.
function rebuildColumnOrder(items: TodoItem[], columnId: string): TodoItem[] {
  const inColumn = items
    .filter((item) => item.status === columnId)
    .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  const newOrders = new Map<string, number>();
  inColumn.forEach((item, i) => newOrders.set(item.id, (i + 1) * ORDER_STEP));
  return items.map((item): TodoItem => {
    const newOrder = newOrders.get(item.id);
    if (newOrder === undefined) return item;
    return { ...item, order: newOrder };
  });
}

const ORDER_STEP = 1000;

// ── Action handlers ───────────────────────────────────────────────

export interface AddColumnInput {
  label?: string;
  isDone?: boolean;
}

export function handleAddColumn(
  columns: StatusColumn[],
  items: TodoItem[],
  input: AddColumnInput,
): ColumnsActionResult {
  if (!input.label || input.label.trim().length === 0) {
    return { kind: "error", status: 400, error: "label required" };
  }
  const baseId = slugify(input.label);
  const id = uniqueId(baseId, new Set(columns.map((column) => column.id)));
  const col: StatusColumn = { id, label: input.label.trim() };
  if (input.isDone === true) col.isDone = true;
  // If the new column is flagged done, demote any existing done
  // columns (only one is allowed at a time) and resync items so the
  // old done column's items are no longer marked completed. The new
  // column itself is empty so there's nothing on its side to sync.
  if (input.isDone === true) {
    const nextColumns = [
      ...columns.map((column) => ({ ...column, isDone: false })),
      col,
    ];
    const { items: nextItems, changed } = resyncDoneMembership(items, id);
    return {
      kind: "success",
      columns: nextColumns,
      ...(changed ? { items: nextItems } : {}),
    };
  }
  return { kind: "success", columns: [...columns, col] };
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
  let nextColumns = columns.map((column) =>
    column.id === id ? patched : column,
  );
  // Toggling done flag is non-trivial: only one column may be done.
  let itemsChanged = false;
  let nextItems = items;
  if (input.isDone === true && !target.isDone) {
    // Promote this column to done; demote everyone else.
    nextColumns = nextColumns.map((column) =>
      column.id === id
        ? { ...column, isDone: true }
        : { id: column.id, label: column.label },
    );
    // Resync `completed` across all items: the new done column's
    // items become true, the old done column's items become false.
    // Doing this with the helper rather than a one-sided pass means
    // both ends of the swap stay consistent.
    const synced = resyncDoneMembership(items, id);
    nextItems = synced.items;
    itemsChanged = synced.changed;
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
  const remaining = columns.filter((column) => column.id !== id);
  // If we just removed the done column, promote the new last column.
  let nextColumns = remaining;
  if (target.isDone) {
    nextColumns = remaining.map((column, i) =>
      i === remaining.length - 1 ? { ...column, isDone: true } : column,
    );
  }
  const newDoneId = doneColumnId(nextColumns);
  // Reassign orphaned items to the (possibly new) done column if the
  // deleted column was done; otherwise to the new default open column.
  const refugeId = target.isDone ? newDoneId : defaultStatusId(nextColumns);
  let itemsChanged = false;
  let nextItems = items.map((it): TodoItem => {
    if (it.status !== id) return it;
    itemsChanged = true;
    return { ...it, status: refugeId };
  });
  if (itemsChanged) {
    // The refuge column might have already had items in it; the ones
    // we just merged in came with their original order values from
    // the deleted column, which can collide with the refuge's
    // existing orders. Re-stripe the whole refuge column to 1000,
    // 2000, ... so the kanban sort stays unique and stable.
    nextItems = rebuildColumnOrder(nextItems, refugeId);
  }
  // Resync the done flag across the result. Necessary in two
  // scenarios: (a) we deleted the done column, so the new last column
  // is now done and its existing items should flip to completed=true;
  // (b) we deleted any other column whose items happened to be the
  // refuge target — already handled by the migration above, but
  // running the helper unconditionally keeps the rest of the items
  // consistent too.
  if (target.isDone) {
    const synced = resyncDoneMembership(nextItems, newDoneId);
    nextItems = synced.items;
    itemsChanged = itemsChanged || synced.changed;
  }
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
  const known = new Set(columns.map((column) => column.id));
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
  const byId = new Map(columns.map((column) => [column.id, column]));
  const next = ids.map((id) => byId.get(id)!);
  return { kind: "success", columns: next };
}
