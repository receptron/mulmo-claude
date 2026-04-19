import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchScheduler,
  handleAdd,
  handleDelete,
  handleReplace,
  handleShow,
  handleUpdate,
  sortItems,
} from "../../server/api/routes/schedulerHandlers.js";
import type { ScheduledItem } from "../../server/api/routes/scheduler.js";

function makeItem(overrides: Partial<ScheduledItem> = {}): ScheduledItem {
  return {
    id: "sched_test_1",
    title: "Default item",
    createdAt: 1_000_000,
    props: {},
    ...overrides,
  };
}

describe("sortItems", () => {
  it("returns a new array, not a reference to the input", () => {
    const items = [makeItem()];
    const sorted = sortItems(items);
    assert.notEqual(sorted, items);
  });

  it("sorts dated items before undated items", () => {
    const dated = makeItem({ id: "a", props: { date: "2026-01-01" } });
    const undated = makeItem({ id: "b" });
    const sorted = sortItems([undated, dated]);
    assert.equal(sorted[0]?.id, "a");
    assert.equal(sorted[1]?.id, "b");
  });

  it("orders dated items chronologically", () => {
    const earlier = makeItem({ id: "a", props: { date: "2026-01-01" } });
    const later = makeItem({ id: "b", props: { date: "2026-02-01" } });
    const sorted = sortItems([later, earlier]);
    assert.equal(sorted[0]?.id, "a");
    assert.equal(sorted[1]?.id, "b");
  });

  it("uses time as a secondary sort key for the same date", () => {
    const morning = makeItem({
      id: "a",
      props: { date: "2026-01-01", time: "09:00" },
    });
    const evening = makeItem({
      id: "b",
      props: { date: "2026-01-01", time: "18:00" },
    });
    const sorted = sortItems([evening, morning]);
    assert.equal(sorted[0]?.id, "a");
    assert.equal(sorted[1]?.id, "b");
  });

  it("orders undated items by createdAt", () => {
    const older = makeItem({ id: "a", createdAt: 1 });
    const newer = makeItem({ id: "b", createdAt: 2 });
    const sorted = sortItems([newer, older]);
    assert.equal(sorted[0]?.id, "a");
    assert.equal(sorted[1]?.id, "b");
  });
});

describe("handleShow", () => {
  it("returns the items unchanged with a count message", () => {
    const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    const result = handleShow(items);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items, items);
    assert.equal(result.message, "Showing 2 scheduled item(s)");
  });

  it("handles an empty list", () => {
    const result = handleShow([]);
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.message, "Showing 0 scheduled item(s)");
  });
});

describe("handleAdd", () => {
  it("returns 400 when title is missing", () => {
    const result = handleAdd([], {});
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 400);
    assert.match(result.error, /title required/);
  });

  it("returns 400 when title is an empty string", () => {
    const result = handleAdd([], { title: "" });
    assert.equal(result.kind, "error");
  });

  it("appends an item with a generated id and given title", () => {
    const result = handleAdd([], { title: "Buy milk" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.title, "Buy milk");
    assert.match(result.items[0]?.id ?? "", /^sched_\d+_[0-9a-f]+$/);
  });

  it("preserves existing items", () => {
    const existing = makeItem({ id: "old" });
    const result = handleAdd([existing], { title: "New" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 2);
    assert.ok(result.items.some((i) => i.id === "old"));
  });

  it("uses provided props", () => {
    const result = handleAdd([], {
      title: "Meeting",
      props: { date: "2026-05-01", time: "10:00" },
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.props.date, "2026-05-01");
  });

  it("defaults props to an empty object", () => {
    const result = handleAdd([], { title: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.items[0]?.props, {});
  });
});

describe("handleDelete", () => {
  it("returns 400 when id is missing", () => {
    const result = handleDelete([makeItem()], {});
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 400);
  });

  it("removes the matching item", () => {
    const a = makeItem({ id: "a" });
    const b = makeItem({ id: "b" });
    const result = handleDelete([a, b], { id: "a" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, "b");
    assert.match(result.message, /Deleted item a/);
  });

  it("reports not found when id doesn't match", () => {
    const result = handleDelete([makeItem({ id: "a" })], { id: "missing" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.match(result.message, /Item not found/);
  });

  it("handles deleting from an empty list", () => {
    const result = handleDelete([], { id: "a" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 0);
  });
});

describe("handleUpdate", () => {
  it("returns 400 when id is missing", () => {
    const result = handleUpdate([makeItem()], {});
    assert.equal(result.kind, "error");
  });

  it("reports not found without mutating when id doesn't match", () => {
    const a = makeItem({ id: "a", title: "Original" });
    const result = handleUpdate([a], { id: "missing", title: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.match(result.message, /Item not found/);
    assert.equal(result.items[0]?.title, "Original");
  });

  it("updates the title when provided", () => {
    const a = makeItem({ id: "a", title: "Old" });
    const result = handleUpdate([a], { id: "a", title: "New" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const updated = result.items.find((i) => i.id === "a");
    assert.equal(updated?.title, "New");
  });

  it("merges props patches by key", () => {
    const a = makeItem({
      id: "a",
      props: { date: "2026-01-01", note: "old" },
    });
    const result = handleUpdate([a], {
      id: "a",
      props: { note: "new" },
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const updated = result.items.find((i) => i.id === "a");
    assert.equal(updated?.props.date, "2026-01-01");
    assert.equal(updated?.props.note, "new");
  });

  it("removes a prop when its patch value is null", () => {
    const a = makeItem({
      id: "a",
      props: { date: "2026-01-01", note: "x" },
    });
    const result = handleUpdate([a], { id: "a", props: { note: null } });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const updated = result.items.find((i) => i.id === "a");
    assert.equal(updated?.props.note, undefined);
    assert.equal(updated?.props.date, "2026-01-01");
  });

  it("does not mutate the input items array", () => {
    const a = makeItem({ id: "a", title: "Old", props: { x: 1 } });
    const items = [a];
    handleUpdate(items, { id: "a", title: "New" });
    assert.equal(a.title, "Old");
    assert.equal(items[0]?.title, "Old");
  });
});

describe("handleReplace", () => {
  it("returns 400 when items is not an array", () => {
    const result = handleReplace([], {});
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 400);
  });

  it("replaces the entire list", () => {
    const old = [makeItem({ id: "old" })];
    const replacement = [makeItem({ id: "a" }), makeItem({ id: "b" })];
    const result = handleReplace(old, { items: replacement });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 2);
    assert.ok(result.items.every((i) => i.id !== "old"));
  });

  it("accepts an empty replacement array", () => {
    const result = handleReplace([makeItem()], { items: [] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 0);
  });

  it("sorts the replacement items", () => {
    const later = makeItem({ id: "b", props: { date: "2026-02-01" } });
    const earlier = makeItem({ id: "a", props: { date: "2026-01-01" } });
    const result = handleReplace([], { items: [later, earlier] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.id, "a");
  });
});

describe("dispatchScheduler", () => {
  it("returns 400 for an unknown action", () => {
    const result = dispatchScheduler("nope", [], {});
    assert.equal(result.kind, "error");
    if (result.kind !== "error") return;
    assert.equal(result.status, 400);
    assert.match(result.error, /Unknown action: nope/);
  });

  it("dispatches show", () => {
    const result = dispatchScheduler("show", [makeItem()], {});
    assert.equal(result.kind, "success");
  });

  it("dispatches add", () => {
    const result = dispatchScheduler("add", [], { title: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
  });

  it("dispatches delete", () => {
    const result = dispatchScheduler("delete", [makeItem({ id: "a" })], {
      id: "a",
    });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 0);
  });

  it("dispatches update", () => {
    const result = dispatchScheduler(
      "update",
      [makeItem({ id: "a", title: "Old" })],
      { id: "a", title: "New" },
    );
    assert.equal(result.kind, "success");
  });

  it("dispatches replace", () => {
    const result = dispatchScheduler("replace", [], {
      items: [makeItem({ id: "x" })],
    });
    assert.equal(result.kind, "success");
  });
});
