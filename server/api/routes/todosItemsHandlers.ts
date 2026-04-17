// Pure handlers for the id-based REST routes used by the file-explorer
// todo view (TodoExplorer.vue). The MCP `manageTodoList` action route
// continues to live in todosHandlers.ts; these handlers are intended
// for the web UI which knows item ids directly and doesn't need the
// substring-match contract that the MCP handlers use.
//
// Each function takes the current items + columns + an input record
// and returns a result. The Express route is responsible for loading
// and saving JSON to disk.

import type { TodoItem, TodoPriority } from "./todos.js";
import {
  type StatusColumn,
  defaultStatusId,
  doneColumnId,
} from "./todosColumnsHandlers.js";
import { mergeLabels } from "../../../src/plugins/todo/labels.js";
import { makeId } from "../../utils/id.js";

const ORDER_STEP = 1000;
const PRIORITIES: readonly TodoPriority[] = ["low", "medium", "high", "urgent"];

// ── Result type ───────────────────────────────────────────────────

export type ItemsActionResult =
  | { kind: "error"; status: number; error: string }
  | { kind: "success"; items: TodoItem[]; item?: TodoItem };

// ── Migration ─────────────────────────────────────────────────────

// Backfill `status` and `order` on items that pre-date the kanban
// extension. Pure / idempotent: items that already have valid values
// pass through unchanged. Done via a single forward pass that assigns
// monotonically-increasing order values per status column so the
// kanban view has a stable initial sort.
//
// Reasoning for the order assignment: legacy items only carry a
// `createdAt`, and we want oldest-first within each column. We can't
// just use createdAt as the order key because it's a milliseconds
// number which makes hand-editing painful and conflicts with the
// 1000-step convention drag-drop uses for new items.
export function migrateItems(
  rawItems: TodoItem[],
  columns: StatusColumn[],
): TodoItem[] {
  const doneId = doneColumnId(columns);
  const openId = defaultStatusId(columns);
  const validStatusIds = new Set(columns.map((c) => c.id));

  // First pass: backfill status. Items pointing at a column that no
  // longer exists are reassigned to the default open or done column
  // depending on `completed`.
  //
  // Note: we deliberately do NOT re-sync `completed` to status on
  // every read. Earlier versions of this function did, but that
  // overrode the legacy MCP `check` / `uncheck` actions — those
  // actions only flip the boolean, never touch status, so a sync
  // pass kept reverting them on the next read. Treating the two
  // fields as independent at the storage layer leaves both the REST
  // PATCH path (which keeps them in sync explicitly) and the legacy
  // MCP actions (which only touch `completed`) working correctly.
  const withStatus = rawItems.map((it): TodoItem => {
    const hasValidStatus =
      typeof it.status === "string" && validStatusIds.has(it.status);
    if (hasValidStatus) return it;
    const status = it.completed ? doneId : openId;
    return { ...it, status };
  });

  // Second pass: backfill order per column. Items that already have
  // an order keep it untouched — only items missing order get one
  // assigned, and they go after the column's current max so they
  // sort to the bottom in createdAt order. This preserves any
  // hand-managed ordering even when a column is a mix of legacy
  // and kanban-aware items.
  const byStatus = new Map<string, TodoItem[]>();
  for (const it of withStatus) {
    const key = it.status ?? openId;
    if (!byStatus.has(key)) byStatus.set(key, []);
    byStatus.get(key)!.push(it);
  }
  const orderById = new Map<string, number>();
  for (const [, group] of byStatus) {
    const missing = group.filter((it) => typeof it.order !== "number");
    if (missing.length === 0) continue;
    const existingMax = group
      .filter((it) => typeof it.order === "number")
      .reduce((acc, it) => Math.max(acc, it.order!), 0);
    const sorted = [...missing].sort((a, b) => a.createdAt - b.createdAt);
    sorted.forEach((it, i) => {
      orderById.set(it.id, existingMax + (i + 1) * ORDER_STEP);
    });
  }
  return withStatus.map((it): TodoItem => {
    const next = orderById.get(it.id);
    if (next === undefined) return it;
    return { ...it, order: next };
  });
}

// ── Validators ────────────────────────────────────────────────────

function isPriority(v: unknown): v is TodoPriority {
  return typeof v === "string" && PRIORITIES.includes(v as TodoPriority);
}

// YYYY-MM-DD only — keep it boring so the column is sortable as text.
function isDueDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function nextOrder(items: TodoItem[], statusId: string): number {
  const inColumn = items
    .filter((i) => i.status === statusId)
    .map((i) => i.order ?? 0);
  if (inColumn.length === 0) return ORDER_STEP;
  return Math.max(...inColumn) + ORDER_STEP;
}

// ── Create ────────────────────────────────────────────────────────

export interface CreateInput {
  text?: string;
  note?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  labels?: string[];
}

// Resolve the status field from input, validating against known
// columns. Returns the resolved column id or an error result.
type ResolveStatusResult =
  | { kind: "ok"; status: string }
  | { kind: "error"; status: number; error: string };

function resolveStatus(
  input: CreateInput,
  columns: StatusColumn[],
): ResolveStatusResult {
  if (input.status === undefined || input.status === "") {
    return { kind: "ok", status: defaultStatusId(columns) };
  }
  const validStatusIds = new Set(columns.map((c) => c.id));
  if (validStatusIds.has(input.status)) {
    return { kind: "ok", status: input.status };
  }
  return {
    kind: "error",
    status: 400,
    error: `unknown status: ${input.status}`,
  };
}

// Apply optional priority + dueDate to an item, returning an error
// result on validation failure.
function applyOptionalFields(
  item: TodoItem,
  input: CreateInput,
): ItemsActionResult | null {
  if (input.priority !== undefined && input.priority !== "") {
    if (!isPriority(input.priority)) {
      return { kind: "error", status: 400, error: "invalid priority" };
    }
    item.priority = input.priority;
  }
  if (input.dueDate !== undefined && input.dueDate !== "") {
    if (!isDueDate(input.dueDate)) {
      return {
        kind: "error",
        status: 400,
        error: "dueDate must be YYYY-MM-DD",
      };
    }
    item.dueDate = input.dueDate;
  }
  return null;
}

export function handleCreate(
  items: TodoItem[],
  columns: StatusColumn[],
  input: CreateInput,
): ItemsActionResult {
  if (!input.text || input.text.trim().length === 0) {
    return { kind: "error", status: 400, error: "text required" };
  }
  const resolved = resolveStatus(input, columns);
  if (resolved.kind === "error") return resolved;

  const status = resolved.status;
  const item: TodoItem = {
    id: makeId("todo"),
    text: input.text.trim(),
    completed: status === doneColumnId(columns),
    createdAt: Date.now(),
    status,
    order: nextOrder(items, status),
  };
  if (input.note !== undefined && input.note !== "") item.note = input.note;
  const normalizedLabels = mergeLabels([], input.labels ?? []);
  if (normalizedLabels.length > 0) item.labels = normalizedLabels;

  const fieldError = applyOptionalFields(item, input);
  if (fieldError) return fieldError;

  return { kind: "success", items: [...items, item], item };
}

// ── Patch ─────────────────────────────────────────────────────────

export interface PatchInput {
  text?: string;
  note?: string | null;
  status?: string;
  priority?: string | null;
  dueDate?: string | null;
  labels?: string[];
  completed?: boolean;
}

// Each `applyXxx` helper mutates `updated` in place and returns either
// `null` (success) or an error result. Splitting them out keeps the
// top-level `handlePatch` linear so it stays under the cognitive
// complexity threshold and so each field's edit semantics live in one
// obvious place.

function applyTextPatch(
  updated: TodoItem,
  input: PatchInput,
): ItemsActionResult | null {
  if (typeof input.text !== "string") return null;
  if (input.text.trim().length === 0) {
    return { kind: "error", status: 400, error: "text cannot be empty" };
  }
  updated.text = input.text.trim();
  return null;
}

function applyNotePatch(updated: TodoItem, input: PatchInput): void {
  if (input.note === null || input.note === "") {
    delete updated.note;
    return;
  }
  if (typeof input.note === "string") updated.note = input.note;
}

function applyLabelsPatch(updated: TodoItem, input: PatchInput): void {
  if (!Array.isArray(input.labels)) return;
  const merged = mergeLabels([], input.labels);
  if (merged.length > 0) updated.labels = merged;
  else delete updated.labels;
}

function applyPriorityPatch(
  updated: TodoItem,
  input: PatchInput,
): ItemsActionResult | null {
  if (input.priority === null || input.priority === "") {
    delete updated.priority;
    return null;
  }
  if (input.priority === undefined) return null;
  if (!isPriority(input.priority)) {
    return { kind: "error", status: 400, error: "invalid priority" };
  }
  updated.priority = input.priority;
  return null;
}

function applyDueDatePatch(
  updated: TodoItem,
  input: PatchInput,
): ItemsActionResult | null {
  if (input.dueDate === null || input.dueDate === "") {
    delete updated.dueDate;
    return null;
  }
  if (input.dueDate === undefined) return null;
  if (!isDueDate(input.dueDate)) {
    return { kind: "error", status: 400, error: "dueDate must be YYYY-MM-DD" };
  }
  updated.dueDate = input.dueDate;
  return null;
}

function applyStatusPatch(
  updated: TodoItem,
  target: TodoItem,
  items: TodoItem[],
  columns: StatusColumn[],
  input: PatchInput,
): ItemsActionResult | null {
  if (typeof input.status !== "string" || input.status === target.status) {
    return null;
  }
  const validStatusIds = new Set(columns.map((c) => c.id));
  if (!validStatusIds.has(input.status)) {
    return {
      kind: "error",
      status: 400,
      error: `unknown status: ${input.status}`,
    };
  }
  updated.status = input.status;
  updated.order = nextOrder(items, input.status);
  updated.completed = input.status === doneColumnId(columns);
  return null;
}

// Explicit `completed` toggle without changing status: lets the user
// check / uncheck a card and have it move between the done column and
// a default open column the obvious way.
function applyCompletedPatch(
  updated: TodoItem,
  items: TodoItem[],
  columns: StatusColumn[],
  input: PatchInput,
): void {
  if (typeof input.completed !== "boolean") return;
  if (input.completed === updated.completed) return;
  updated.completed = input.completed;
  const targetStatus = input.completed
    ? doneColumnId(columns)
    : defaultStatusId(columns);
  if (targetStatus !== updated.status) {
    updated.status = targetStatus;
    updated.order = nextOrder(items, targetStatus);
  }
}

export function handlePatch(
  items: TodoItem[],
  columns: StatusColumn[],
  id: string,
  input: PatchInput,
): ItemsActionResult {
  const target = items.find((i) => i.id === id);
  if (!target) {
    return { kind: "error", status: 404, error: `item not found: ${id}` };
  }
  const updated: TodoItem = { ...target };

  // Each step short-circuits on validation failure. Order matters:
  // status changes happen before completed-toggling so an explicit
  // completed: true alongside a non-done status doesn't fight itself.
  const steps: Array<() => ItemsActionResult | null | void> = [
    () => applyTextPatch(updated, input),
    () => applyNotePatch(updated, input),
    () => applyLabelsPatch(updated, input),
    () => applyPriorityPatch(updated, input),
    () => applyDueDatePatch(updated, input),
    () => applyStatusPatch(updated, target, items, columns, input),
    () => applyCompletedPatch(updated, items, columns, input),
  ];
  for (const step of steps) {
    const err = step();
    if (err) return err;
  }

  const next = items.map((it) => (it.id === id ? updated : it));
  return { kind: "success", items: next, item: updated };
}

// ── Move (drag & drop) ────────────────────────────────────────────

// Reorder + cross-column move in a single call. `position` is the
// 0-based index the item should occupy in its target column AFTER
// the move (with the moving item itself excluded from the count).
//
// We rebuild the entire target column's order field for simplicity:
// it's O(n) per column, which for a kanban with hundreds of items is
// negligible and makes the math obviously correct.
export interface MoveInput {
  status?: string;
  position?: number;
}

export function handleMove(
  items: TodoItem[],
  columns: StatusColumn[],
  id: string,
  input: MoveInput,
): ItemsActionResult {
  const target = items.find((i) => i.id === id);
  if (!target) {
    return { kind: "error", status: 404, error: `item not found: ${id}` };
  }
  const validStatusIds = new Set(columns.map((c) => c.id));
  const newStatus = input.status ?? target.status ?? defaultStatusId(columns);
  if (!validStatusIds.has(newStatus)) {
    return {
      kind: "error",
      status: 400,
      error: `unknown status: ${newStatus}`,
    };
  }
  const isDone = newStatus === doneColumnId(columns);
  const updatedSelf: TodoItem = {
    ...target,
    status: newStatus,
    completed: isDone,
  };
  // Re-collect the items in the target column with the moving item
  // pulled out, then splice it back in at `position`.
  const others = items
    .filter((it) => it.id !== id && it.status === newStatus)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const insertAt = clampPosition(input.position, others.length);
  const reordered = [...others];
  reordered.splice(insertAt, 0, updatedSelf);
  // Reassign order values 1000 / 2000 / 3000 ...
  const reorderedById = new Map<string, number>();
  reordered.forEach((it, i) => reorderedById.set(it.id, (i + 1) * ORDER_STEP));
  const nextItems = items.map((it): TodoItem => {
    const newOrder = reorderedById.get(it.id);
    if (it.id === id) {
      const out: TodoItem = {
        ...updatedSelf,
        order: newOrder ?? updatedSelf.order ?? ORDER_STEP,
      };
      return out;
    }
    if (newOrder !== undefined) return { ...it, order: newOrder };
    return it;
  });
  const finalSelf = nextItems.find((it) => it.id === id)!;
  return { kind: "success", items: nextItems, item: finalSelf };
}

function clampPosition(raw: number | undefined, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return max;
  if (raw < 0) return 0;
  if (raw > max) return max;
  return Math.floor(raw);
}

// ── Delete ────────────────────────────────────────────────────────

export function handleDeleteItem(
  items: TodoItem[],
  id: string,
): ItemsActionResult {
  const target = items.find((i) => i.id === id);
  if (!target) {
    return { kind: "error", status: 404, error: `item not found: ${id}` };
  }
  return { kind: "success", items: items.filter((it) => it.id !== id) };
}
