// Pure action handlers for the todos POST route. Same shape as
// schedulerHandlers.ts: each handler takes the current items + the
// relevant body fields and returns a discriminated result describing
// either an HTTP error or the next state. The route handler in
// todos.ts dispatches to one of these and translates the result into
// an HTTP response.
//
// Keeping the action logic pure (no I/O, no globals) makes every
// case unit-testable in isolation, and brings the cognitive
// complexity of the route handler under the lint threshold.

import type { TodoItem } from "./todos.js";
import { filterByLabels, listLabelsWithCount, mergeLabels, subtractLabels } from "../../../src/plugins/todo/labels.js";
import { makeId } from "../../utils/id.js";

export interface TodosActionInput {
  text?: string;
  newText?: string;
  note?: string;
  // For `add`: labels to tag the new item with.
  // For `add_label` / `remove_label`: labels to add to / remove from
  // the item matched by `text`.
  labels?: string[];
  // For `show`: OR-semantics filter that restricts the returned list
  // to items carrying at least one of these labels (case-insensitive).
  filterLabels?: string[];
}

export type TodosActionResult =
  | { kind: "error"; status: number; error: string }
  | {
      kind: "success";
      items: TodoItem[];
      message: string;
      jsonData: Record<string, unknown>;
    };

// Substring match (case-insensitive). Used by delete / update /
// check / uncheck / add_label / remove_label — all share the same
// lookup contract.
export function findTodoByText(items: TodoItem[], text: string): TodoItem | undefined {
  const needle = text.toLowerCase();
  return items.find((i) => i.text.toLowerCase().includes(needle));
}

export function handleShow(items: TodoItem[], input: TodosActionInput): TodosActionResult {
  const filterLabels = input.filterLabels ?? [];
  const filtered = filterByLabels(items, filterLabels);
  const filtering = filterLabels.length > 0;
  const message = filtering
    ? `Showing ${filtered.length} of ${items.length} todo item(s) filtered by: ${filterLabels.join(", ")}`
    : `Showing ${items.length} todo item(s)`;
  return {
    kind: "success",
    items: filtered,
    message,
    jsonData: {
      items: filtered.map((i) => ({
        text: i.text,
        completed: i.completed,
        ...(i.labels && i.labels.length > 0 && { labels: i.labels }),
      })),
    },
  };
}

export function handleAdd(items: TodoItem[], input: TodosActionInput): TodosActionResult {
  if (!input.text) {
    return { kind: "error", status: 400, error: "text required" };
  }
  // Normalise incoming labels by routing them through
  // `mergeLabels([], labels ?? [])` — that handles trim / collapse /
  // case-insensitive dedup in one shot.
  const normalizedLabels = mergeLabels([], input.labels ?? []);
  const item: TodoItem = {
    id: makeId("todo"),
    text: input.text,
    ...(input.note !== undefined && { note: input.note }),
    ...(normalizedLabels.length > 0 && { labels: normalizedLabels }),
    completed: false,
    createdAt: Date.now(),
  };
  return {
    kind: "success",
    items: [...items, item],
    message: normalizedLabels.length > 0 ? `Added: "${input.text}" [${normalizedLabels.join(", ")}]` : `Added: "${input.text}"`,
    jsonData: { added: input.text, labels: normalizedLabels },
  };
}

export function handleDelete(items: TodoItem[], input: TodosActionInput): TodosActionResult {
  if (!input.text) {
    return { kind: "error", status: 400, error: "text required" };
  }
  const needle = input.text.toLowerCase();
  const next = items.filter((i) => !i.text.toLowerCase().includes(needle));
  const found = next.length < items.length;
  return {
    kind: "success",
    items: next,
    message: found ? `Deleted: "${input.text}"` : `Item not found: "${input.text}"`,
    jsonData: { deleted: input.text },
  };
}

export function handleUpdate(items: TodoItem[], input: TodosActionInput): TodosActionResult {
  if (!input.text || !input.newText) {
    return { kind: "error", status: 400, error: "text and newText required" };
  }
  const target = findTodoByText(items, input.text);
  if (!target) {
    return {
      kind: "success",
      items,
      message: `Item not found: "${input.text}"`,
      jsonData: {},
    };
  }
  const oldText = target.text;
  const updated: TodoItem = {
    ...target,
    text: input.newText,
    note: input.note !== undefined ? input.note || undefined : target.note,
  };
  const next = items.map((i) => (i.id === target.id ? updated : i));
  return {
    kind: "success",
    items: next,
    message: `Updated: "${oldText}" → "${input.newText}"`,
    jsonData: { oldText, newText: input.newText },
  };
}

function setCompleted(
  items: TodoItem[],
  input: TodosActionInput,
  completed: boolean,
  verb: "Checked" | "Unchecked",
  jsonKey: "checkedItem" | "uncheckedItem",
): TodosActionResult {
  if (!input.text) {
    return { kind: "error", status: 400, error: "text required" };
  }
  const target = findTodoByText(items, input.text);
  if (!target) {
    return {
      kind: "success",
      items,
      message: `Item not found: "${input.text}"`,
      jsonData: {},
    };
  }
  const updated: TodoItem = { ...target, completed };
  const next = items.map((i) => (i.id === target.id ? updated : i));
  return {
    kind: "success",
    items: next,
    message: `${verb}: "${target.text}"`,
    jsonData: { [jsonKey]: target.text },
  };
}

export function handleCheck(items: TodoItem[], input: TodosActionInput): TodosActionResult {
  return setCompleted(items, input, true, "Checked", "checkedItem");
}

export function handleUncheck(items: TodoItem[], input: TodosActionInput): TodosActionResult {
  return setCompleted(items, input, false, "Unchecked", "uncheckedItem");
}

export function handleClearCompleted(items: TodoItem[]): TodosActionResult {
  const count = items.filter((i) => i.completed).length;
  const next = items.filter((i) => !i.completed);
  return {
    kind: "success",
    items: next,
    message: `Cleared ${count} completed item(s)`,
    jsonData: { clearedCount: count },
  };
}

export function handleAddLabel(items: TodoItem[], input: TodosActionInput): TodosActionResult {
  if (!input.text || !input.labels || input.labels.length === 0) {
    return {
      kind: "error",
      status: 400,
      error: "text and a non-empty labels array required",
    };
  }
  const target = findTodoByText(items, input.text);
  if (!target) {
    return {
      kind: "success",
      items,
      message: `Item not found: "${input.text}"`,
      jsonData: { notFound: input.text },
    };
  }
  const merged = mergeLabels(target.labels ?? [], input.labels);
  const updated: TodoItem = { ...target, labels: merged };
  const next = items.map((i) => (i.id === target.id ? updated : i));
  return {
    kind: "success",
    items: next,
    message: `Labels on "${target.text}": ${merged.join(", ")}`,
    jsonData: { item: target.text, labels: merged },
  };
}

export function handleRemoveLabel(items: TodoItem[], input: TodosActionInput): TodosActionResult {
  if (!input.text || !input.labels || input.labels.length === 0) {
    return {
      kind: "error",
      status: 400,
      error: "text and a non-empty labels array required",
    };
  }
  const target = findTodoByText(items, input.text);
  if (!target) {
    return {
      kind: "success",
      items,
      message: `Item not found: "${input.text}"`,
      jsonData: { notFound: input.text },
    };
  }
  const remaining = subtractLabels(target.labels ?? [], input.labels);
  const updated: TodoItem = { ...target };
  if (remaining.length > 0) {
    updated.labels = remaining;
  } else {
    delete updated.labels;
  }
  const next = items.map((i) => (i.id === target.id ? updated : i));
  return {
    kind: "success",
    items: next,
    message: remaining.length > 0 ? `Labels on "${target.text}": ${remaining.join(", ")}` : `"${target.text}" now has no labels`,
    jsonData: { item: target.text, labels: remaining },
  };
}

export function handleListLabels(items: TodoItem[]): TodosActionResult {
  const inventory = listLabelsWithCount(items);
  const summary = inventory.map((l) => `${l.label} (${l.count})`).join(", ");
  const message = inventory.length === 0 ? "No labels in use" : `${inventory.length} label(s) in use: ${summary}`;
  return {
    kind: "success",
    items,
    message,
    jsonData: { labels: inventory },
  };
}

const HANDLERS: Record<string, (items: TodoItem[], input: TodosActionInput) => TodosActionResult> = {
  show: handleShow,
  add: handleAdd,
  delete: handleDelete,
  update: handleUpdate,
  check: handleCheck,
  uncheck: handleUncheck,
  clear_completed: handleClearCompleted,
  add_label: handleAddLabel,
  remove_label: handleRemoveLabel,
  list_labels: handleListLabels,
};

export function dispatchTodos(action: string, items: TodoItem[], input: TodosActionInput): TodosActionResult {
  const handler = HANDLERS[action];
  if (!handler) {
    return { kind: "error", status: 400, error: `Unknown action: ${action}` };
  }
  return handler(items, input);
}
