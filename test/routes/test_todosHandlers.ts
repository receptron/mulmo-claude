import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchTodos,
  findTodoByText,
  handleAdd,
  handleAddLabel,
  handleCheck,
  handleClearCompleted,
  handleDelete,
  handleListLabels,
  handleRemoveLabel,
  handleShow,
  handleUncheck,
  handleUpdate,
} from "../../server/api/routes/todosHandlers.js";
import type { TodoItem } from "../../server/api/routes/todos.js";

function makeTodo(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: "todo_test_1",
    text: "Default item",
    completed: false,
    createdAt: 1_000_000,
    ...overrides,
  };
}

describe("findTodoByText", () => {
  it("returns the first item containing the substring (case-insensitive)", () => {
    const todoA = makeTodo({ id: "a", text: "Buy milk" });
    const todoB = makeTodo({ id: "b", text: "Walk the dog" });
    assert.equal(findTodoByText([todoA, todoB], "MILK")?.id, "a");
    assert.equal(findTodoByText([todoA, todoB], "dog")?.id, "b");
  });

  it("returns undefined when no item matches", () => {
    assert.equal(findTodoByText([makeTodo({ text: "x" })], "y"), undefined);
  });

  it("matches partial substrings", () => {
    const item = makeTodo({ text: "Submit quarterly report" });
    assert.equal(findTodoByText([item], "quarter")?.id, item.id);
  });

  it("returns undefined for empty list", () => {
    assert.equal(findTodoByText([], "anything"), undefined);
  });
});

describe("handleShow", () => {
  it("returns items + count message + jsonData with text/completed pairs", () => {
    const items = [makeTodo({ id: "a", text: "x", completed: true }), makeTodo({ id: "b", text: "y", completed: false })];
    const result = handleShow(items, {});
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.message, "Showing 2 todo item(s)");
    assert.deepEqual(result.jsonData.items, [
      { text: "x", completed: true },
      { text: "y", completed: false },
    ]);
  });

  it("handles an empty list", () => {
    const result = handleShow([], {});
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.message, "Showing 0 todo item(s)");
  });

  it("includes labels in jsonData when present", () => {
    const items = [makeTodo({ id: "a", text: "x", labels: ["work", "urgent"] }), makeTodo({ id: "b", text: "y" })];
    const result = handleShow(items, {});
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const jsonItems = result.jsonData.items as {
      text: string;
      labels?: string[];
    }[];
    assert.deepEqual(jsonItems[0]?.labels, ["work", "urgent"]);
    assert.equal(jsonItems[1]?.labels, undefined);
  });

  it("returns the filtered subset when filterLabels is non-empty", () => {
    const items = [
      makeTodo({ id: "a", text: "x", labels: ["work"] }),
      makeTodo({ id: "b", text: "y", labels: ["personal"] }),
      makeTodo({ id: "c", text: "z" }),
    ];
    const result = handleShow(items, { filterLabels: ["work"] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, "a");
    assert.match(result.message, /Showing 1 of 3/);
    assert.match(result.message, /work/);
  });

  it("treats an empty filterLabels as no filter", () => {
    const items = [makeTodo({ id: "a", labels: ["work"] }), makeTodo({ id: "b" })];
    const result = handleShow(items, { filterLabels: [] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 2);
  });
});

describe("handleAdd", () => {
  it("returns 400 when text missing", () => {
    const result = handleAdd([], {});
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 400);
  });

  it("appends an item with generated id", () => {
    const result = handleAdd([], { text: "New" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.text, "New");
    assert.equal(result.items[0]?.completed, false);
    assert.match(result.items[0]?.id ?? "", /^todo_\d+_[0-9a-f]+$/);
  });

  it("preserves existing items", () => {
    const existing = makeTodo({ id: "old" });
    const result = handleAdd([existing], { text: "New" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 2);
    assert.ok(result.items.some((i) => i.id === "old"));
  });

  it("includes note when provided", () => {
    const result = handleAdd([], { text: "x", note: "details here" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.note, "details here");
  });

  it("omits note when not provided", () => {
    const result = handleAdd([], { text: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.note, undefined);
  });
});

describe("handleDelete", () => {
  it("returns 400 when text missing", () => {
    const result = handleDelete([makeTodo()], {});
    assert.equal(result.kind, "error");
  });

  it("removes items matching the substring", () => {
    const items = [makeTodo({ id: "a", text: "Buy milk" }), makeTodo({ id: "b", text: "Walk dog" })];
    const result = handleDelete(items, { text: "milk" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, "b");
    assert.match(result.message, /Deleted/);
  });

  it("reports not found when no item matches", () => {
    const result = handleDelete([makeTodo({ text: "x" })], { text: "missing" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.match(result.message, /not found/);
  });

  it("deletes multiple items if multiple match", () => {
    const items = [makeTodo({ id: "a", text: "milk in fridge" }), makeTodo({ id: "b", text: "almond milk" }), makeTodo({ id: "c", text: "bread" })];
    const result = handleDelete(items, { text: "milk" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, "c");
  });
});

describe("handleUpdate", () => {
  it("returns 400 when text or newText missing", () => {
    assert.equal(handleUpdate([], { text: "x" }).kind, "error");
    assert.equal(handleUpdate([], { newText: "y" }).kind, "error");
    assert.equal(handleUpdate([], {}).kind, "error");
  });

  it("reports not found without mutating when no match", () => {
    const todoA = makeTodo({ id: "a", text: "Original" });
    const result = handleUpdate([todoA], { text: "missing", newText: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.match(result.message, /not found/);
    assert.equal(result.items[0]?.text, "Original");
  });

  it("updates the matched item's text", () => {
    const todoA = makeTodo({ id: "a", text: "Old" });
    const result = handleUpdate([todoA], { text: "old", newText: "New" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.text, "New");
  });

  it("updates note when provided", () => {
    const todoA = makeTodo({ id: "a", text: "x", note: "old" });
    const result = handleUpdate([todoA], {
      text: "x",
      newText: "y",
      note: "new",
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.note, "new");
  });

  it("clears note when an empty string is passed", () => {
    const todoA = makeTodo({ id: "a", text: "x", note: "old" });
    const result = handleUpdate([todoA], { text: "x", newText: "y", note: "" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.note, undefined);
  });

  it("does not mutate the original item", () => {
    const todoA = makeTodo({ id: "a", text: "Old" });
    handleUpdate([todoA], { text: "old", newText: "New" });
    assert.equal(todoA.text, "Old");
  });
});

describe("handleCheck", () => {
  it("returns 400 when text missing", () => {
    assert.equal(handleCheck([], {}).kind, "error");
  });

  it("marks the matched item completed=true", () => {
    const todoA = makeTodo({ id: "a", text: "x", completed: false });
    const result = handleCheck([todoA], { text: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.completed, true);
    assert.match(result.message, /Checked/);
  });

  it("reports not found without mutating when no match", () => {
    const todoA = makeTodo({ id: "a", text: "x", completed: false });
    const result = handleCheck([todoA], { text: "missing" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.completed, false);
  });

  it("does not mutate the original item", () => {
    const todoA = makeTodo({ id: "a", text: "x", completed: false });
    handleCheck([todoA], { text: "x" });
    assert.equal(todoA.completed, false);
  });
});

describe("handleUncheck", () => {
  it("returns 400 when text missing", () => {
    assert.equal(handleUncheck([], {}).kind, "error");
  });

  it("marks the matched item completed=false", () => {
    const todoA = makeTodo({ id: "a", text: "x", completed: true });
    const result = handleUncheck([todoA], { text: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.completed, false);
    assert.match(result.message, /Unchecked/);
  });
});

describe("handleClearCompleted", () => {
  it("removes only completed items", () => {
    const items = [makeTodo({ id: "a", completed: false }), makeTodo({ id: "b", completed: true }), makeTodo({ id: "c", completed: true })];
    const result = handleClearCompleted(items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, "a");
    assert.equal(result.jsonData.clearedCount, 2);
  });

  it("returns 0 cleared on an empty list", () => {
    const result = handleClearCompleted([]);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.jsonData.clearedCount, 0);
  });

  it("returns 0 cleared when nothing is completed", () => {
    const items = [makeTodo({ id: "a", completed: false }), makeTodo({ id: "b", completed: false })];
    const result = handleClearCompleted(items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 2);
    assert.equal(result.jsonData.clearedCount, 0);
  });
});

describe("handleAdd labels", () => {
  it("normalizes and stores provided labels", () => {
    const result = handleAdd([], { text: "Buy milk", labels: ["  Work  "] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.items[0]?.labels, ["Work"]);
    assert.match(result.message, /\[Work\]/);
  });

  it("dedupes labels case-insensitively", () => {
    const result = handleAdd([], {
      text: "x",
      labels: ["work", "Work", "WORK"],
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.labels?.length, 1);
  });

  it("omits the labels field entirely when none provided", () => {
    const result = handleAdd([], { text: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.labels, undefined);
  });
});

describe("handleAddLabel", () => {
  it("returns 400 when text or labels missing", () => {
    assert.equal(handleAddLabel([], { text: "x" }).kind, "error");
    assert.equal(handleAddLabel([], { labels: ["a"] }).kind, "error");
    assert.equal(handleAddLabel([], { text: "x", labels: [] }).kind, "error");
  });

  it("merges new labels into the matched item", () => {
    const todoA = makeTodo({ id: "a", text: "thing", labels: ["work"] });
    const result = handleAddLabel([todoA], {
      text: "thing",
      labels: ["urgent"],
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.items[0]?.labels, ["work", "urgent"]);
  });

  it("dedupes when adding an existing label", () => {
    const todoA = makeTodo({ id: "a", text: "x", labels: ["work"] });
    const result = handleAddLabel([todoA], { text: "x", labels: ["WORK"] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.labels?.length, 1);
  });

  it("reports not found without mutating", () => {
    const todoA = makeTodo({ id: "a", text: "thing", labels: ["work"] });
    const result = handleAddLabel([todoA], {
      text: "missing",
      labels: ["urgent"],
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.match(result.message, /not found/);
    assert.deepEqual(result.items[0]?.labels, ["work"]);
  });

  it("does not mutate the input item", () => {
    const todoA = makeTodo({ id: "a", text: "thing", labels: ["work"] });
    handleAddLabel([todoA], { text: "thing", labels: ["urgent"] });
    assert.deepEqual(todoA.labels, ["work"]);
  });
});

describe("handleRemoveLabel", () => {
  it("returns 400 when text or labels missing", () => {
    assert.equal(handleRemoveLabel([], { text: "x" }).kind, "error");
    assert.equal(handleRemoveLabel([], { labels: ["a"] }).kind, "error");
  });

  it("removes the matching labels case-insensitively", () => {
    const todoA = makeTodo({
      id: "a",
      text: "thing",
      labels: ["Work", "Urgent"],
    });
    const result = handleRemoveLabel([todoA], {
      text: "thing",
      labels: ["work"],
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.items[0]?.labels, ["Urgent"]);
  });

  it("deletes the labels field when removing the last one", () => {
    const todoA = makeTodo({ id: "a", text: "x", labels: ["work"] });
    const result = handleRemoveLabel([todoA], {
      text: "x",
      labels: ["work"],
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.labels, undefined);
    assert.match(result.message, /no labels/);
  });

  it("is a no-op when removing a label that isn't present", () => {
    const todoA = makeTodo({ id: "a", text: "x", labels: ["work"] });
    const result = handleRemoveLabel([todoA], {
      text: "x",
      labels: ["personal"],
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.items[0]?.labels, ["work"]);
  });
});

describe("handleListLabels", () => {
  it("returns no labels message for empty list", () => {
    const result = handleListLabels([]);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.match(result.message, /No labels in use/);
  });

  it("counts each distinct label across items", () => {
    const items = [makeTodo({ id: "a", labels: ["work", "urgent"] }), makeTodo({ id: "b", labels: ["work"] }), makeTodo({ id: "c", labels: ["personal"] })];
    const result = handleListLabels(items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const inventory = result.jsonData.labels as {
      label: string;
      count: number;
    }[];
    const work = inventory.find((labelItem) => labelItem.label.toLowerCase() === "work");
    assert.equal(work?.count, 2);
  });
});

describe("dispatchTodos", () => {
  it("returns 400 for unknown action", () => {
    const result = dispatchTodos("nope", [], {});
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.match(result.error, /Unknown action: nope/);
  });

  it("dispatches each known action", () => {
    const items = [makeTodo({ id: "a", text: "thing", completed: false, labels: ["work"] })];
    assert.equal(dispatchTodos("show", items, {}).kind, "success");
    assert.equal(dispatchTodos("add", items, { text: "x" }).kind, "success");
    assert.equal(dispatchTodos("delete", items, { text: "thing" }).kind, "success");
    assert.equal(dispatchTodos("update", items, { text: "thing", newText: "thing2" }).kind, "success");
    assert.equal(dispatchTodos("check", items, { text: "thing" }).kind, "success");
    assert.equal(dispatchTodos("uncheck", items, { text: "thing" }).kind, "success");
    assert.equal(dispatchTodos("clear_completed", items, {}).kind, "success");
    assert.equal(dispatchTodos("add_label", items, { text: "thing", labels: ["urgent"] }).kind, "success");
    assert.equal(dispatchTodos("remove_label", items, { text: "thing", labels: ["work"] }).kind, "success");
    assert.equal(dispatchTodos("list_labels", items, {}).kind, "success");
  });
});

// Regression: the kanban view stores extra fields (status / priority /
// dueDate / order) on TodoItem. The MCP `update` handler must keep
// those fields when changing text / note, otherwise an LLM editing a
// label-only field would silently strip the kanban metadata.
describe("kanban field preservation", () => {
  it("handleUpdate preserves status / priority / dueDate / order", () => {
    const item = makeTodo({
      id: "a",
      text: "Old",
      status: "in-progress",
      priority: "high",
      dueDate: "2026-04-20",
      order: 2500,
    });
    const result = handleUpdate([item], { text: "old", newText: "New" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const updated = result.items[0];
    assert.equal(updated?.text, "New");
    assert.equal(updated?.status, "in-progress");
    assert.equal(updated?.priority, "high");
    assert.equal(updated?.dueDate, "2026-04-20");
    assert.equal(updated?.order, 2500);
  });

  it("handleCheck preserves status / priority / dueDate / order", () => {
    const item = makeTodo({
      id: "a",
      text: "x",
      completed: false,
      status: "in-progress",
      priority: "urgent",
      dueDate: "2026-05-01",
      order: 4500,
    });
    const result = handleCheck([item], { text: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const updated = result.items[0];
    assert.equal(updated?.completed, true);
    assert.equal(updated?.status, "in-progress");
    assert.equal(updated?.priority, "urgent");
    assert.equal(updated?.dueDate, "2026-05-01");
    assert.equal(updated?.order, 4500);
  });

  it("handleAddLabel preserves status / priority / dueDate / order", () => {
    const item = makeTodo({
      id: "a",
      text: "x",
      labels: ["work"],
      status: "todo",
      priority: "medium",
      dueDate: "2026-06-01",
      order: 1500,
    });
    const result = handleAddLabel([item], { text: "x", labels: ["urgent"] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const updated = result.items[0];
    assert.deepEqual(updated?.labels, ["work", "urgent"]);
    assert.equal(updated?.status, "todo");
    assert.equal(updated?.priority, "medium");
    assert.equal(updated?.dueDate, "2026-06-01");
    assert.equal(updated?.order, 1500);
  });
});
