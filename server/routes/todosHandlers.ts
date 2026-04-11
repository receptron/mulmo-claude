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
import { randomBytes } from "crypto";

export interface TodosActionInput {
  text?: string;
  newText?: string;
  note?: string;
}

export type TodosActionResult =
  | { kind: "error"; status: number; error: string }
  | {
      kind: "success";
      items: TodoItem[];
      message: string;
      jsonData: Record<string, unknown>;
    };

function makeId(): string {
  return `todo_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

// Substring match (case-insensitive). Used by delete / update /
// check / uncheck — all share the same lookup contract.
export function findTodoByText(
  items: TodoItem[],
  text: string,
): TodoItem | undefined {
  const needle = text.toLowerCase();
  return items.find((i) => i.text.toLowerCase().includes(needle));
}

export function handleShow(items: TodoItem[]): TodosActionResult {
  return {
    kind: "success",
    items,
    message: `Showing ${items.length} todo item(s)`,
    jsonData: {
      items: items.map((i) => ({ text: i.text, completed: i.completed })),
    },
  };
}

export function handleAdd(
  items: TodoItem[],
  input: TodosActionInput,
): TodosActionResult {
  if (!input.text) {
    return { kind: "error", status: 400, error: "text required" };
  }
  const item: TodoItem = {
    id: makeId(),
    text: input.text,
    ...(input.note !== undefined && { note: input.note }),
    completed: false,
    createdAt: Date.now(),
  };
  return {
    kind: "success",
    items: [...items, item],
    message: `Added: "${input.text}"`,
    jsonData: { added: input.text },
  };
}

export function handleDelete(
  items: TodoItem[],
  input: TodosActionInput,
): TodosActionResult {
  if (!input.text) {
    return { kind: "error", status: 400, error: "text required" };
  }
  const needle = input.text.toLowerCase();
  const next = items.filter((i) => !i.text.toLowerCase().includes(needle));
  const found = next.length < items.length;
  return {
    kind: "success",
    items: next,
    message: found
      ? `Deleted: "${input.text}"`
      : `Item not found: "${input.text}"`,
    jsonData: { deleted: input.text },
  };
}

export function handleUpdate(
  items: TodoItem[],
  input: TodosActionInput,
): TodosActionResult {
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

export function handleCheck(
  items: TodoItem[],
  input: TodosActionInput,
): TodosActionResult {
  return setCompleted(items, input, true, "Checked", "checkedItem");
}

export function handleUncheck(
  items: TodoItem[],
  input: TodosActionInput,
): TodosActionResult {
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

const HANDLERS: Record<
  string,
  (items: TodoItem[], input: TodosActionInput) => TodosActionResult
> = {
  show: handleShow,
  add: handleAdd,
  delete: handleDelete,
  update: handleUpdate,
  check: handleCheck,
  uncheck: handleUncheck,
  clear_completed: handleClearCompleted,
};

export function dispatchTodos(
  action: string,
  items: TodoItem[],
  input: TodosActionInput,
): TodosActionResult {
  const handler = HANDLERS[action];
  if (!handler) {
    return { kind: "error", status: 400, error: `Unknown action: ${action}` };
  }
  return handler(items, input);
}
