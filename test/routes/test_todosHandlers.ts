import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchTodos,
  findTodoByText,
  handleAdd,
  handleCheck,
  handleClearCompleted,
  handleDelete,
  handleShow,
  handleUncheck,
  handleUpdate,
} from "../../server/routes/todosHandlers.js";
import type { TodoItem } from "../../server/routes/todos.js";

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
    const a = makeTodo({ id: "a", text: "Buy milk" });
    const b = makeTodo({ id: "b", text: "Walk the dog" });
    assert.equal(findTodoByText([a, b], "MILK")?.id, "a");
    assert.equal(findTodoByText([a, b], "dog")?.id, "b");
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
    const items = [
      makeTodo({ id: "a", text: "x", completed: true }),
      makeTodo({ id: "b", text: "y", completed: false }),
    ];
    const result = handleShow(items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.message, "Showing 2 todo item(s)");
    assert.deepEqual(result.jsonData.items, [
      { text: "x", completed: true },
      { text: "y", completed: false },
    ]);
  });

  it("handles an empty list", () => {
    const result = handleShow([]);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.message, "Showing 0 todo item(s)");
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
    const items = [
      makeTodo({ id: "a", text: "Buy milk" }),
      makeTodo({ id: "b", text: "Walk dog" }),
    ];
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
    const items = [
      makeTodo({ id: "a", text: "milk in fridge" }),
      makeTodo({ id: "b", text: "almond milk" }),
      makeTodo({ id: "c", text: "bread" }),
    ];
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
    const a = makeTodo({ id: "a", text: "Original" });
    const result = handleUpdate([a], { text: "missing", newText: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.match(result.message, /not found/);
    assert.equal(result.items[0]?.text, "Original");
  });

  it("updates the matched item's text", () => {
    const a = makeTodo({ id: "a", text: "Old" });
    const result = handleUpdate([a], { text: "old", newText: "New" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.text, "New");
  });

  it("updates note when provided", () => {
    const a = makeTodo({ id: "a", text: "x", note: "old" });
    const result = handleUpdate([a], {
      text: "x",
      newText: "y",
      note: "new",
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.note, "new");
  });

  it("clears note when an empty string is passed", () => {
    const a = makeTodo({ id: "a", text: "x", note: "old" });
    const result = handleUpdate([a], { text: "x", newText: "y", note: "" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.note, undefined);
  });

  it("does not mutate the original item", () => {
    const a = makeTodo({ id: "a", text: "Old" });
    handleUpdate([a], { text: "old", newText: "New" });
    assert.equal(a.text, "Old");
  });
});

describe("handleCheck", () => {
  it("returns 400 when text missing", () => {
    assert.equal(handleCheck([], {}).kind, "error");
  });

  it("marks the matched item completed=true", () => {
    const a = makeTodo({ id: "a", text: "x", completed: false });
    const result = handleCheck([a], { text: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.completed, true);
    assert.match(result.message, /Checked/);
  });

  it("reports not found without mutating when no match", () => {
    const a = makeTodo({ id: "a", text: "x", completed: false });
    const result = handleCheck([a], { text: "missing" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.completed, false);
  });

  it("does not mutate the original item", () => {
    const a = makeTodo({ id: "a", text: "x", completed: false });
    handleCheck([a], { text: "x" });
    assert.equal(a.completed, false);
  });
});

describe("handleUncheck", () => {
  it("returns 400 when text missing", () => {
    assert.equal(handleUncheck([], {}).kind, "error");
  });

  it("marks the matched item completed=false", () => {
    const a = makeTodo({ id: "a", text: "x", completed: true });
    const result = handleUncheck([a], { text: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.completed, false);
    assert.match(result.message, /Unchecked/);
  });
});

describe("handleClearCompleted", () => {
  it("removes only completed items", () => {
    const items = [
      makeTodo({ id: "a", completed: false }),
      makeTodo({ id: "b", completed: true }),
      makeTodo({ id: "c", completed: true }),
    ];
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
    const items = [
      makeTodo({ id: "a", completed: false }),
      makeTodo({ id: "b", completed: false }),
    ];
    const result = handleClearCompleted(items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 2);
    assert.equal(result.jsonData.clearedCount, 0);
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
    const items = [makeTodo({ id: "a", text: "thing", completed: false })];
    assert.equal(dispatchTodos("show", items, {}).kind, "success");
    assert.equal(dispatchTodos("add", items, { text: "x" }).kind, "success");
    assert.equal(
      dispatchTodos("delete", items, { text: "thing" }).kind,
      "success",
    );
    assert.equal(
      dispatchTodos("update", items, { text: "thing", newText: "thing2" }).kind,
      "success",
    );
    assert.equal(
      dispatchTodos("check", items, { text: "thing" }).kind,
      "success",
    );
    assert.equal(
      dispatchTodos("uncheck", items, { text: "thing" }).kind,
      "success",
    );
    assert.equal(dispatchTodos("clear_completed", items, {}).kind, "success");
  });
});
