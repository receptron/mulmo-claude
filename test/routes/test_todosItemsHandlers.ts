import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { handleCreate, handleDeleteItem, handleMove, handlePatch, migrateItems } from "../../server/api/routes/todosItemsHandlers.js";
import { DEFAULT_COLUMNS } from "../../server/api/routes/todosColumnsHandlers.js";
import type { TodoItem } from "../../server/api/routes/todos.js";

function cols() {
  return DEFAULT_COLUMNS.map((col) => ({ ...col }));
}

function makeItem(overrides: Partial<TodoItem> = {}): TodoItem {
  return {
    id: "todo_test_1",
    text: "Default item",
    completed: false,
    createdAt: 1_000_000,
    status: "todo",
    order: 1000,
    ...overrides,
  };
}

describe("migrateItems", () => {
  it("backfills status and order on legacy items", () => {
    const legacy: TodoItem[] = [
      {
        id: "a",
        text: "Done item",
        completed: true,
        createdAt: 100,
      },
      {
        id: "b",
        text: "Open item",
        completed: false,
        createdAt: 200,
      },
    ];
    const result = migrateItems(legacy, cols());
    const itemA = result.find((i) => i.id === "a");
    const itemB = result.find((i) => i.id === "b");
    assert.equal(itemA?.status, "done");
    assert.equal(itemA?.completed, true);
    assert.equal(itemB?.status, "backlog");
    assert.equal(itemB?.completed, false);
    assert.equal(typeof itemA?.order, "number");
    assert.equal(typeof itemB?.order, "number");
  });

  it("reassigns items pointing at unknown columns", () => {
    const items: TodoItem[] = [
      {
        id: "a",
        text: "x",
        completed: false,
        createdAt: 100,
        status: "ghost-column",
        order: 500,
      },
    ];
    const result = migrateItems(items, cols());
    assert.equal(result[0]?.status, "backlog");
  });

  it("does NOT re-sync completed against status on read", () => {
    // Migration treats `status` and `completed` as independent at
    // the storage layer so the legacy MCP `check`/`uncheck` actions
    // (which only flip the boolean and never touch status) keep
    // working. Re-syncing here used to revert their effect on the
    // very next read.
    const items: TodoItem[] = [
      {
        id: "a",
        text: "x",
        completed: false,
        createdAt: 100,
        status: "done",
        order: 1000,
      },
      {
        id: "b",
        text: "y",
        completed: true,
        createdAt: 200,
        status: "todo",
        order: 1000,
      },
    ];
    const result = migrateItems(items, cols());
    assert.equal(result.find((i) => i.id === "a")?.completed, false);
    assert.equal(result.find((i) => i.id === "b")?.completed, true);
  });

  it("preserves existing order values when every item in a column has one", () => {
    const items: TodoItem[] = [
      {
        id: "a",
        text: "x",
        completed: false,
        createdAt: 100,
        status: "todo",
        order: 5,
      },
      {
        id: "b",
        text: "y",
        completed: false,
        createdAt: 200,
        status: "todo",
        order: 7,
      },
    ];
    const result = migrateItems(items, cols());
    assert.equal(result.find((i) => i.id === "a")?.order, 5);
    assert.equal(result.find((i) => i.id === "b")?.order, 7);
  });

  it("preserves existing orders and appends missing-order items at the end", () => {
    // Mixed group: items with order keep their values; items without
    // get assigned values strictly greater than the existing max so
    // they sort to the bottom in createdAt order. This avoids
    // clobbering hand-managed orders just because one item lacks one.
    const items: TodoItem[] = [
      {
        id: "a",
        text: "x",
        completed: false,
        createdAt: 100,
        status: "todo",
        order: 5,
      },
      {
        id: "b",
        text: "y",
        completed: false,
        createdAt: 200,
        status: "todo",
      },
      {
        id: "c",
        text: "z",
        completed: false,
        createdAt: 50,
        status: "todo",
      },
    ];
    const result = migrateItems(items, cols());
    assert.equal(result.find((i) => i.id === "a")?.order, 5);
    // c is missing order; createdAt 50 < b's 200 → c gets the smaller
    // appended slot. Existing max in column = 5, so c=1005, b=2005.
    assert.equal(result.find((i) => i.id === "c")?.order, 1005);
    assert.equal(result.find((i) => i.id === "b")?.order, 2005);
  });
});

describe("handleCreate", () => {
  it("rejects empty text", () => {
    const result = handleCreate([], cols(), { text: "  " });
    assert.equal(result.kind, "error");
  });

  it("creates with default status when none specified", () => {
    const result = handleCreate([], cols(), { text: "New" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.status, "backlog");
    assert.equal(result.item?.completed, false);
    assert.equal(result.item?.order, 1000);
  });

  it("creates in done column → completed true", () => {
    const result = handleCreate([], cols(), { text: "Did it", status: "done" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.completed, true);
  });

  it("rejects an explicitly-unknown status with 400 (no silent fallback)", () => {
    const result = handleCreate([], cols(), { text: "x", status: "ghost" });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 400);
  });

  it("falls back to default status when status is undefined", () => {
    const result = handleCreate([], cols(), { text: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.status, "backlog");
  });

  it("rejects invalid priority", () => {
    const result = handleCreate([], cols(), { text: "x", priority: "huge" });
    assert.equal(result.kind, "error");
  });

  it("rejects malformed dueDate", () => {
    const result = handleCreate([], cols(), {
      text: "x",
      dueDate: "next tuesday",
    });
    assert.equal(result.kind, "error");
  });

  it("normalises labels", () => {
    const result = handleCreate([], cols(), {
      text: "x",
      labels: ["  Work ", "WORK", "Urgent"],
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.item?.labels, ["Work", "Urgent"]);
  });

  it("places new items at the end of their column", () => {
    const items = [makeItem({ id: "a", status: "todo", order: 1000 }), makeItem({ id: "b", status: "todo", order: 2500 })];
    const result = handleCreate(items, cols(), { text: "z", status: "todo" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.order, 3500);
  });
});

describe("handlePatch", () => {
  it("returns 404 for unknown id", () => {
    const result = handlePatch([], cols(), "ghost", { text: "x" });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 404);
  });

  it("rejects empty text", () => {
    const items = [makeItem({ id: "a" })];
    const result = handlePatch(items, cols(), "a", { text: "  " });
    assert.equal(result.kind, "error");
  });

  it("clears note when set to empty string", () => {
    const items = [makeItem({ id: "a", note: "old" })];
    const result = handlePatch(items, cols(), "a", { note: "" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.note, undefined);
  });

  it("changes status and resyncs completed", () => {
    const items = [makeItem({ id: "a", status: "todo", completed: false })];
    const result = handlePatch(items, cols(), "a", { status: "done" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.status, "done");
    assert.equal(result.item?.completed, true);
  });

  it("rejects unknown status", () => {
    const items = [makeItem({ id: "a" })];
    const result = handlePatch(items, cols(), "a", { status: "ghost" });
    assert.equal(result.kind, "error");
  });

  it("toggling completed=true moves the item into the done column", () => {
    const items = [makeItem({ id: "a", status: "todo", completed: false })];
    const result = handlePatch(items, cols(), "a", { completed: true });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.completed, true);
    assert.equal(result.item?.status, "done");
  });

  it("toggling completed=false moves the item to the default open column", () => {
    const items = [makeItem({ id: "a", status: "done", completed: true })];
    const result = handlePatch(items, cols(), "a", { completed: false });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.completed, false);
    assert.equal(result.item?.status, "backlog");
  });

  it("rejects invalid priority", () => {
    const items = [makeItem({ id: "a" })];
    const result = handlePatch(items, cols(), "a", { priority: "huge" });
    assert.equal(result.kind, "error");
  });

  it("clears priority when set to null", () => {
    const items = [makeItem({ id: "a", priority: "high" })];
    const result = handlePatch(items, cols(), "a", { priority: null });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.priority, undefined);
  });

  it("clears dueDate when set to empty string", () => {
    const items = [makeItem({ id: "a", dueDate: "2026-01-01" })];
    const result = handlePatch(items, cols(), "a", { dueDate: "" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.dueDate, undefined);
  });
});

describe("handleMove", () => {
  it("returns 404 for unknown id", () => {
    const result = handleMove([], cols(), "ghost", { position: 0 });
    assert.equal(result.kind, "error");
  });

  it("moves an item across columns and updates completed", () => {
    const items = [makeItem({ id: "a", status: "todo", order: 1000, completed: false })];
    const result = handleMove(items, cols(), "a", {
      status: "done",
      position: 0,
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.item?.status, "done");
    assert.equal(result.item?.completed, true);
  });

  it("reorders within a single column", () => {
    const items = [
      makeItem({ id: "a", status: "todo", order: 1000 }),
      makeItem({ id: "b", status: "todo", order: 2000 }),
      makeItem({ id: "c", status: "todo", order: 3000 }),
    ];
    // Move "a" to the end of the todo column.
    const result = handleMove(items, cols(), "a", {
      status: "todo",
      position: 2,
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const todoItems = result.items.filter((i) => i.status === "todo").sort((itemX, itemY) => (itemX.order ?? 0) - (itemY.order ?? 0));
    assert.deepEqual(
      todoItems.map((i) => i.id),
      ["b", "c", "a"],
    );
  });

  it("clamps a position past the end", () => {
    const items = [makeItem({ id: "a", status: "todo", order: 1000 }), makeItem({ id: "b", status: "todo", order: 2000 })];
    const result = handleMove(items, cols(), "a", {
      status: "todo",
      position: 999,
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const todoItems = result.items.filter((i) => i.status === "todo").sort((itemX, itemY) => (itemX.order ?? 0) - (itemY.order ?? 0));
    assert.deepEqual(
      todoItems.map((i) => i.id),
      ["b", "a"],
    );
  });

  it("rejects unknown status", () => {
    const items = [makeItem({ id: "a" })];
    const result = handleMove(items, cols(), "a", { status: "ghost" });
    assert.equal(result.kind, "error");
  });
});

describe("handleDeleteItem", () => {
  it("returns 404 for unknown id", () => {
    const result = handleDeleteItem([], "ghost");
    assert.equal(result.kind, "error");
  });

  it("removes the matching item", () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    const result = handleDeleteItem(items, "a");
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, "b");
  });
});
