import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dispatchScheduler,
  handleAdd,
  handleDelete,
  handleReplace,
  handleShow,
  handleUpdate,
  sanitizeProps,
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
    const itemA = makeItem({ id: "a" });
    const itemB = makeItem({ id: "b" });
    const result = handleDelete([itemA, itemB], { id: "a" });
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
    const itemA = makeItem({ id: "a", title: "Original" });
    const result = handleUpdate([itemA], { id: "missing", title: "x" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.match(result.message, /Item not found/);
    assert.equal(result.items[0]?.title, "Original");
  });

  it("updates the title when provided", () => {
    const itemA = makeItem({ id: "a", title: "Old" });
    const result = handleUpdate([itemA], { id: "a", title: "New" });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const updated = result.items.find((i) => i.id === "a");
    assert.equal(updated?.title, "New");
  });

  it("merges props patches by key", () => {
    const itemA = makeItem({
      id: "a",
      props: { date: "2026-01-01", note: "old" },
    });
    const result = handleUpdate([itemA], {
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
    const itemA = makeItem({
      id: "a",
      props: { date: "2026-01-01", note: "x" },
    });
    const result = handleUpdate([itemA], { id: "a", props: { note: null } });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const updated = result.items.find((i) => i.id === "a");
    assert.equal(updated?.props.note, undefined);
    assert.equal(updated?.props.date, "2026-01-01");
  });

  it("does not mutate the input items array", () => {
    const itemA = makeItem({ id: "a", title: "Old", props: { x: 1 } });
    const items = [itemA];
    handleUpdate(items, { id: "a", title: "New" });
    assert.equal(itemA.title, "Old");
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

describe("multi-day events (endDate)", () => {
  it("sanitizeProps keeps a well-formed range untouched", () => {
    const props = { date: "2026-05-27", endDate: "2026-05-29" };
    assert.equal(sanitizeProps(props), props);
  });

  it("sanitizeProps preserves a malformed-but-string endDate (view surfaces it as 'broken')", () => {
    // Earlier versions silently dropped these — but the user
    // never noticed their typo. Keeping the raw bad string lets
    // the view render a broken-chip UI so the user/LLM gets a
    // visible cue to fix it.
    const beforeStart = { date: "2026-05-27", endDate: "2026-05-25" };
    assert.equal(sanitizeProps(beforeStart).endDate, "2026-05-25");

    const noStart = { endDate: "2026-05-29" };
    assert.equal(sanitizeProps(noStart).endDate, "2026-05-29");

    const notIso = { date: "2026-05-27", endDate: "next Friday" };
    assert.equal(sanitizeProps(notIso).endDate, "next Friday");
  });

  it("sanitizeProps drops non-string endDate (crash protection)", () => {
    const numEnd = { date: "2026-05-27", endDate: 20260529 as unknown as string };
    assert.equal(sanitizeProps(numEnd).endDate, undefined);
  });

  it("sanitizeProps keeps an equal-day endDate (single-day explicit range)", () => {
    const props = { date: "2026-05-27", endDate: "2026-05-27" };
    assert.equal(sanitizeProps(props).endDate, "2026-05-27");
  });

  it("sanitizeProps coerces non-object input to an empty props object", () => {
    // req.body.props is not runtime-validated upstream, so malformed
    // payloads (number / null / string / array) must not throw.
    assert.deepEqual(sanitizeProps(1), {});
    assert.deepEqual(sanitizeProps("hello"), {});
    assert.deepEqual(sanitizeProps(null), {});
    assert.deepEqual(sanitizeProps(undefined), {});
    assert.deepEqual(sanitizeProps([1, 2, 3]), {});
    assert.deepEqual(sanitizeProps(true), {});
  });

  it("handleAdd does not crash on non-object props payload", () => {
    const result = handleAdd([], { title: "x", props: 1 as unknown as Record<string, string> });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.items[0]?.props, {});
  });

  it("handleReplace tolerates items whose props are non-object", () => {
    const broken = { id: "a", title: "x", createdAt: 0, props: 1 as unknown as Record<string, string> };
    const result = handleReplace([], { items: [broken] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.deepEqual(result.items[0]?.props, {});
  });

  it("handleReplace mints a string id for items missing one (color-hash crash protection)", () => {
    const noId = { title: "no id", createdAt: 100, props: {} } as unknown as ScheduledItem;
    const numericId = { id: 12345 as unknown as string, title: "num", createdAt: 200, props: {} };
    const result = handleReplace([], { items: [noId, numericId] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 2);
    for (const item of result.items) {
      assert.equal(typeof item.id, "string");
      assert.ok(item.id.length > 0);
    }
  });

  it("handleReplace coerces missing / malformed title and createdAt to safe defaults", () => {
    const before = Date.now();
    const malformed = { id: "a", title: 42 as unknown as string, createdAt: "soon" as unknown as number, props: {} };
    const result = handleReplace([], { items: [malformed] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.title, "");
    assert.ok((result.items[0]?.createdAt ?? 0) >= before);
  });

  it("handleReplace drops non-object items and reports the count in jsonData", () => {
    const valid = makeItem({ id: "ok", props: {} });
    const result = handleReplace([], { items: [valid, null as unknown as ScheduledItem, "string" as unknown as ScheduledItem, 7 as unknown as ScheduledItem] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items.length, 1);
    assert.equal(result.jsonData.dropped, 3);
  });

  it("handleAdd persists a valid endDate", () => {
    const result = handleAdd([], { title: "Trip", props: { date: "2026-05-27", endDate: "2026-05-29" } });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.props.endDate, "2026-05-29");
  });

  it("handleAdd preserves a malformed endDate string for the broken-chip UI", () => {
    const result = handleAdd([], { title: "Trip", props: { date: "2026-05-27", endDate: "2026-05-25" } });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.props.date, "2026-05-27");
    assert.equal(result.items[0]?.props.endDate, "2026-05-25");
  });

  it("handleUpdate accepts a valid endDate patch", () => {
    const original = makeItem({ id: "a", props: { date: "2026-05-27" } });
    const result = handleUpdate([original], { id: "a", props: { endDate: "2026-05-29" } });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.props.endDate, "2026-05-29");
  });

  it("handleUpdate preserves an invalid endDate patch string and applies other patched props", () => {
    const original = makeItem({ id: "a", props: { date: "2026-05-27" } });
    const result = handleUpdate([original], { id: "a", props: { endDate: "2026-05-25", location: "Tokyo" } });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.props.endDate, "2026-05-25");
    assert.equal(result.items[0]?.props.location, "Tokyo");
  });

  it("handleUpdate honours a null patch to remove endDate", () => {
    const original = makeItem({ id: "a", props: { date: "2026-05-27", endDate: "2026-05-29" } });
    const result = handleUpdate([original], { id: "a", props: { endDate: null } });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    assert.equal(result.items[0]?.props.endDate, undefined);
  });

  it("handleReplace preserves string endDate values for every item (view handles malformed)", () => {
    const good = makeItem({ id: "a", props: { date: "2026-05-27", endDate: "2026-05-29" } });
    const bad = makeItem({ id: "b", props: { date: "2026-05-27", endDate: "2026-05-25" } });
    const result = handleReplace([], { items: [good, bad] });
    assert.equal(result.kind, "success");
    if (result.kind !== "success") return;
    const byId = Object.fromEntries(result.items.map((i) => [i.id, i]));
    assert.equal(byId.a?.props.endDate, "2026-05-29");
    assert.equal(byId.b?.props.endDate, "2026-05-25");
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
    const result = dispatchScheduler("update", [makeItem({ id: "a", title: "Old" })], { id: "a", title: "New" });
    assert.equal(result.kind, "success");
  });

  it("dispatches replace", () => {
    const result = dispatchScheduler("replace", [], {
      items: [makeItem({ id: "x" })],
    });
    assert.equal(result.kind, "success");
  });

  // Proto-key regression (#2319): `action` is untrusted (LLM tool arg / HTTP
  // body). A bare `HANDLERS[action]` resolves `constructor`/`toString` to an
  // Object.prototype function that is truthy and callable, so it slips past the
  // unknown-action guard and RUNS instead of being rejected.
  for (const proto of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
    it(`rejects the prototype key "${proto}" as an unknown action`, () => {
      const result = dispatchScheduler(proto, [makeItem({ id: "a" })], {});
      assert.equal(result.kind, "error");
      if (result.kind !== "error") return;
      assert.equal(result.status, 400);
      assert.equal(result.error, `Unknown action: ${proto}`);
    });
  }
});
