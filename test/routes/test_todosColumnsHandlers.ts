import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COLUMNS,
  defaultStatusId,
  doneColumnId,
  handleAddColumn,
  handleDeleteColumn,
  handlePatchColumn,
  handleReorderColumns,
  normalizeColumns,
  type StatusColumn,
} from "../../server/api/routes/todosColumnsHandlers.js";
import type { TodoItem } from "../../server/api/routes/todos.js";

function cols(): StatusColumn[] {
  // Fresh copy each call so mutations in one test don't bleed.
  return DEFAULT_COLUMNS.map((c) => ({ ...c }));
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

describe("normalizeColumns", () => {
  it("returns DEFAULT_COLUMNS when input is not an array", () => {
    assert.deepEqual(normalizeColumns(null), DEFAULT_COLUMNS);
    assert.deepEqual(normalizeColumns({}), DEFAULT_COLUMNS);
    assert.deepEqual(normalizeColumns("nope"), DEFAULT_COLUMNS);
  });

  it("returns DEFAULT_COLUMNS for an empty array", () => {
    assert.deepEqual(normalizeColumns([]), DEFAULT_COLUMNS);
  });

  it("strips entries missing id or label", () => {
    const result = normalizeColumns([{ id: "a", label: "A" }, { id: 5, label: "B" }, { id: "c" }, { label: "D" }, { id: "e", label: "E" }]);
    assert.deepEqual(
      result.map((c) => c.id),
      ["a", "e"],
    );
  });

  it("falls back to defaults if ids collide", () => {
    const result = normalizeColumns([
      { id: "a", label: "A" },
      { id: "a", label: "A2" },
    ]);
    assert.deepEqual(result, DEFAULT_COLUMNS);
  });

  it("promotes the last column to isDone if no done flag is set", () => {
    const result = normalizeColumns([
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ]);
    assert.equal(result[result.length - 1]?.isDone, true);
  });

  it("keeps only the first isDone flag when multiple are set", () => {
    const result = normalizeColumns([
      { id: "a", label: "A", isDone: true },
      { id: "b", label: "B", isDone: true },
    ]);
    assert.equal(result[0]?.isDone, true);
    assert.equal(result[1]?.isDone, undefined);
  });
});

describe("doneColumnId / defaultStatusId", () => {
  it("returns the isDone column id and the first non-done id", () => {
    assert.equal(doneColumnId(cols()), "done");
    assert.equal(defaultStatusId(cols()), "backlog");
  });
});

describe("handleAddColumn", () => {
  it("rejects empty label", () => {
    const result = handleAddColumn(cols(), [], { label: "  " });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 400);
  });

  it("appends a slugified column", () => {
    const result = handleAddColumn(cols(), [], { label: "In Review!" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.columns.length, 5);
    assert.equal(result.columns[4]?.id, "in_review");
    assert.equal(result.columns[4]?.label, "In Review!");
  });

  it("disambiguates colliding ids", () => {
    const start = [...cols(), { id: "review", label: "Review" } as StatusColumn];
    const result = handleAddColumn(start, [], { label: "Review" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.columns[result.columns.length - 1]?.id, "review_2");
  });

  it("generates distinct hash-based ids for different Japanese labels", () => {
    // Previously both would fall back to id="column" and collide. The
    // fix hashes the UTF-8 bytes so distinct labels yield distinct ids.
    const afterFirst = handleAddColumn(cols(), [], { label: "完了" });
    assert.equal(afterFirst.kind, "success");
    if (afterFirst.kind !== "success") return;
    const firstId = afterFirst.columns[afterFirst.columns.length - 1]?.id;
    assert.ok(firstId && firstId !== "column");

    const afterSecond = handleAddColumn(afterFirst.columns, [], {
      label: "進行中",
    });
    assert.equal(afterSecond.kind, "success");
    if (afterSecond.kind !== "success") return;
    const secondId = afterSecond.columns[afterSecond.columns.length - 1]?.id;
    assert.ok(secondId && secondId !== "column");
    assert.notEqual(secondId, firstId);
  });

  it("preserves an ASCII prefix when a mixed label has a useful one", () => {
    const result = handleAddColumn(cols(), [], { label: "Doing (進行中)" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const id = result.columns[result.columns.length - 1]?.id;
    assert.ok(id?.startsWith("doing_"));
  });

  it("is deterministic — same label always yields the same id", () => {
    const a = handleAddColumn(cols(), [], { label: "完了" });
    const b = handleAddColumn(cols(), [], { label: "完了" });
    if (a.kind !== "success" || b.kind !== "success") {
      assert.fail("both should succeed");
    }
    assert.equal(a.columns[a.columns.length - 1]?.id, b.columns[b.columns.length - 1]?.id);
  });

  it("demotes existing done columns when isDone is true", () => {
    const result = handleAddColumn(cols(), [], {
      label: "Archived",
      isDone: true,
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const doneIds = result.columns.filter((c) => c.isDone).map((c) => c.id);
    assert.deepEqual(doneIds, ["archived"]);
  });

  it("resyncs `completed` on items in the old done column when adding a new isDone column", () => {
    // Items in the original "done" column carry completed=true. When
    // a brand-new column is promoted to be the done column, the old
    // ones should flip back to completed=false because their column
    // is no longer the done column.
    const items = [makeItem({ id: "a", status: "done", completed: true }), makeItem({ id: "b", status: "todo", completed: false })];
    const result = handleAddColumn(cols(), items, {
      label: "Archived",
      isDone: true,
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const a = result.items?.find((i) => i.id === "a");
    const b = result.items?.find((i) => i.id === "b");
    assert.equal(a?.completed, false);
    assert.equal(b?.completed, false);
  });

  it("does not resync items when adding a non-done column", () => {
    const items = [makeItem({ id: "a", status: "done", completed: true })];
    const result = handleAddColumn(cols(), items, { label: "Review" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    // No items field on the result because nothing changed.
    assert.equal(result.items, undefined);
  });
});

describe("handlePatchColumn", () => {
  it("renames a column without touching items", () => {
    const items = [makeItem({ status: "todo" })];
    const result = handlePatchColumn(cols(), "todo", { label: "Up Next" }, items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.columns.find((c) => c.id === "todo")?.label, "Up Next");
    assert.equal(result.items, undefined);
  });

  it("returns 404 for an unknown column id", () => {
    const result = handlePatchColumn(cols(), "ghost", { label: "x" }, []);
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 404);
  });

  it("promoting a column to done demotes the prior done column and syncs items in BOTH directions", () => {
    const items = [makeItem({ id: "a", status: "in_progress", completed: false }), makeItem({ id: "b", status: "done", completed: true })];
    const result = handlePatchColumn(cols(), "in_progress", { isDone: true }, items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const inProgress = result.columns.find((c) => c.id === "in_progress");
    const done = result.columns.find((c) => c.id === "done");
    assert.equal(inProgress?.isDone, true);
    assert.equal(done?.isDone, undefined);
    // "a" is now in the new done column → completed should be true.
    assert.equal(result.items?.find((i) => i.id === "a")?.completed, true);
    // "b" stayed in the old (now non-done) "done" column → completed
    // should flip to false. Symmetrical: column-level intent is
    // explicit user action so we sync both ends, unlike the legacy
    // MCP `check` action which only flips the boolean.
    assert.equal(result.items?.find((i) => i.id === "b")?.completed, false);
  });

  it("refuses to demote the only done column", () => {
    const result = handlePatchColumn(cols(), "done", { isDone: false }, []);
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 400);
  });
});

describe("handleDeleteColumn", () => {
  it("returns 404 for an unknown column id", () => {
    const result = handleDeleteColumn(cols(), "ghost", []);
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 404);
  });

  it("refuses to delete the last remaining column", () => {
    const result = handleDeleteColumn([{ id: "only", label: "Only", isDone: true }], "only", []);
    assert.equal(result.kind, "error");
  });

  it("removes a non-done column and migrates its items to the open default", () => {
    const items = [makeItem({ id: "a", status: "backlog" }), makeItem({ id: "b", status: "todo" })];
    const result = handleDeleteColumn(cols(), "backlog", items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(
      result.columns.find((c) => c.id === "backlog"),
      undefined,
    );
    // "a" was in backlog → moves to first non-done column (now "todo")
    assert.equal(result.items?.find((i) => i.id === "a")?.status, "todo");
    assert.equal(result.items?.find((i) => i.id === "a")?.completed, false);
  });

  it("rebuilds the refuge column's order so merged items don't collide", () => {
    // Both source and destination columns happen to have items at
    // orders 1000/2000. Naively merging would leave duplicate orders
    // in the destination, breaking the kanban sort. The handler
    // should re-stripe the refuge column.
    const items = [
      makeItem({ id: "a", status: "backlog", order: 1000 }),
      makeItem({ id: "b", status: "backlog", order: 2000 }),
      makeItem({ id: "c", status: "todo", order: 1000 }),
      makeItem({ id: "d", status: "todo", order: 2000 }),
    ];
    const result = handleDeleteColumn(cols(), "backlog", items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    // All four items now live in "todo" with unique, contiguous orders.
    const todoItems = result.items!.filter((i) => i.status === "todo").sort((x, y) => (x.order ?? 0) - (y.order ?? 0));
    const orders = todoItems.map((i) => i.order);
    // No duplicates.
    assert.equal(new Set(orders).size, 4);
    // Stripe is 1000, 2000, 3000, 4000.
    assert.deepEqual(orders, [1000, 2000, 3000, 4000]);
  });

  it("removing the done column promotes a new done column and marks orphans complete", () => {
    const items = [makeItem({ id: "a", status: "done", completed: true }), makeItem({ id: "b", status: "todo", completed: false })];
    const result = handleDeleteColumn(cols(), "done", items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(
      result.columns.find((c) => c.id === "done"),
      undefined,
    );
    const last = result.columns[result.columns.length - 1];
    assert.equal(last?.isDone, true);
    // Orphan from old done column moved to new done column.
    const a = result.items?.find((i) => i.id === "a");
    assert.equal(a?.status, last?.id);
    assert.equal(a?.completed, true);
  });
});

describe("handleReorderColumns", () => {
  it("rejects when ids count differs", () => {
    const result = handleReorderColumns(cols(), ["todo", "done"]);
    assert.equal(result.kind, "error");
  });

  it("rejects unknown ids", () => {
    const result = handleReorderColumns(cols(), ["todo", "done", "in_progress", "ghost"]);
    assert.equal(result.kind, "error");
  });

  it("rejects duplicate ids", () => {
    const result = handleReorderColumns(cols(), ["todo", "todo", "in_progress", "done"]);
    assert.equal(result.kind, "error");
  });

  it("returns columns in the requested order", () => {
    const result = handleReorderColumns(cols(), ["done", "in_progress", "todo", "backlog"]);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(
      result.columns.map((c) => c.id),
      ["done", "in_progress", "todo", "backlog"],
    );
  });
});
