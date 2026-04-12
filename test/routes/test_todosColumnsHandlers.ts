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
} from "../../server/routes/todosColumnsHandlers.js";
import type { TodoItem } from "../../server/routes/todos.js";

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
    const result = normalizeColumns([
      { id: "a", label: "A" },
      { id: 5, label: "B" },
      { id: "c" },
      { label: "D" },
      { id: "e", label: "E" },
    ]);
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
    const result = handleAddColumn(cols(), { label: "  " });
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 400);
  });

  it("appends a slugified column", () => {
    const result = handleAddColumn(cols(), { label: "In Review!" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.columns.length, 5);
    assert.equal(result.columns[4]?.id, "in_review");
    assert.equal(result.columns[4]?.label, "In Review!");
  });

  it("disambiguates colliding ids", () => {
    const start = [
      ...cols(),
      { id: "review", label: "Review" } as StatusColumn,
    ];
    const result = handleAddColumn(start, { label: "Review" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.columns[result.columns.length - 1]?.id, "review_2");
  });

  it("demotes existing done columns when isDone is true", () => {
    const result = handleAddColumn(cols(), {
      label: "Archived",
      isDone: true,
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const doneIds = result.columns.filter((c) => c.isDone).map((c) => c.id);
    assert.deepEqual(doneIds, ["archived"]);
  });
});

describe("handlePatchColumn", () => {
  it("renames a column without touching items", () => {
    const items = [makeItem({ status: "todo" })];
    const result = handlePatchColumn(
      cols(),
      "todo",
      { label: "Up Next" },
      items,
    );
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

  it("promoting a column to done demotes the prior done column and syncs items", () => {
    const items = [
      makeItem({ id: "a", status: "in_progress", completed: false }),
      makeItem({ id: "b", status: "done", completed: true }),
    ];
    const result = handlePatchColumn(
      cols(),
      "in_progress",
      { isDone: true },
      items,
    );
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const inProgress = result.columns.find((c) => c.id === "in_progress");
    const done = result.columns.find((c) => c.id === "done");
    assert.equal(inProgress?.isDone, true);
    assert.equal(done?.isDone, undefined);
    assert.equal(result.items?.find((i) => i.id === "a")?.completed, true);
    // Item "b" was in the now-non-done column; we don't unilaterally
    // un-complete it (it kept its completed flag from before).
    assert.equal(result.items?.find((i) => i.id === "b")?.completed, true);
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
    const result = handleDeleteColumn(
      [{ id: "only", label: "Only", isDone: true }],
      "only",
      [],
    );
    assert.equal(result.kind, "error");
  });

  it("removes a non-done column and migrates its items to the open default", () => {
    const items = [
      makeItem({ id: "a", status: "backlog" }),
      makeItem({ id: "b", status: "todo" }),
    ];
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

  it("removing the done column promotes a new done column and marks orphans complete", () => {
    const items = [
      makeItem({ id: "a", status: "done", completed: true }),
      makeItem({ id: "b", status: "todo", completed: false }),
    ];
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
    const result = handleReorderColumns(cols(), [
      "todo",
      "done",
      "in_progress",
      "ghost",
    ]);
    assert.equal(result.kind, "error");
  });

  it("rejects duplicate ids", () => {
    const result = handleReorderColumns(cols(), [
      "todo",
      "todo",
      "in_progress",
      "done",
    ]);
    assert.equal(result.kind, "error");
  });

  it("returns columns in the requested order", () => {
    const result = handleReorderColumns(cols(), [
      "done",
      "in_progress",
      "todo",
      "backlog",
    ]);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(
      result.columns.map((c) => c.id),
      ["done", "in_progress", "todo", "backlog"],
    );
  });
});
