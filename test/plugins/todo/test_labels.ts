import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLabel,
  labelsEqual,
  colorForLabel,
  LABEL_PALETTE,
  filterByLabels,
  listLabelsWithCount,
  mergeLabels,
  subtractLabels,
} from "../../../src/plugins/todo/labels.js";

describe("normalizeLabel", () => {
  it("trims leading and trailing whitespace", () => {
    assert.equal(normalizeLabel("  Work  "), "Work");
  });

  it("collapses internal whitespace runs to single space", () => {
    assert.equal(normalizeLabel("High   Priority"), "High Priority");
  });

  it("preserves case", () => {
    assert.equal(normalizeLabel("ShoppingList"), "ShoppingList");
  });

  it("returns null for empty string", () => {
    assert.equal(normalizeLabel(""), null);
  });

  it("returns null for whitespace-only", () => {
    assert.equal(normalizeLabel("   "), null);
    assert.equal(normalizeLabel("\t\n  "), null);
  });

  it("handles a multi-byte character label", () => {
    assert.equal(normalizeLabel("仕事"), "仕事");
  });
});

describe("labelsEqual", () => {
  it("matches identical labels", () => {
    assert.equal(labelsEqual("Work", "Work"), true);
  });

  it("matches case-insensitively", () => {
    assert.equal(labelsEqual("Work", "work"), true);
    assert.equal(labelsEqual("WORK", "Work"), true);
  });

  it("treats normalised whitespace as equal", () => {
    assert.equal(labelsEqual(" Work ", "work"), true);
    assert.equal(labelsEqual("High  Priority", "high priority"), true);
  });

  it("rejects different labels", () => {
    assert.equal(labelsEqual("Work", "Personal"), false);
  });

  it("returns false when either side is empty", () => {
    assert.equal(labelsEqual("", "Work"), false);
    assert.equal(labelsEqual("Work", ""), false);
  });
});

describe("colorForLabel", () => {
  it("always returns a value from LABEL_PALETTE", () => {
    for (const input of ["Work", "", "abc", "ZZZZZZ", "仕事", "1"]) {
      const color = colorForLabel(input);
      assert.ok(LABEL_PALETTE.includes(color), `expected palette entry, got "${color}" for "${input}"`);
    }
  });

  it("is deterministic for the same input", () => {
    const colorA = colorForLabel("Urgent");
    const colorB = colorForLabel("Urgent");
    assert.equal(colorA, colorB);
  });

  it("is case-insensitive", () => {
    assert.equal(colorForLabel("Work"), colorForLabel("work"));
    assert.equal(colorForLabel("WORK"), colorForLabel("Work"));
  });

  it("maps visibly different labels to varied colours (spot check)", () => {
    // Not required to be unique, but a handful of common labels
    // shouldn't all collide on the same slot.
    const samples = ["Work", "Personal", "Urgent", "Groceries", "Shopping", "Books"];
    const colors = new Set(samples.map(colorForLabel));
    assert.ok(colors.size >= 3, `expected at least 3 distinct colours from ${samples.length} samples, got ${colors.size}`);
  });
});

describe("filterByLabels", () => {
  const items = [
    { id: "a", labels: ["Work", "Urgent"] },
    { id: "b", labels: ["Personal"] },
    { id: "c", labels: ["Work"] },
    { id: "d" /* no labels */ },
    { id: "e", labels: [] },
  ];

  it("returns all items when filter is empty", () => {
    const result = filterByLabels(items, []);
    assert.equal(result.length, items.length);
  });

  it("returns all items when filter contains only empty strings", () => {
    const result = filterByLabels(items, ["", "   "]);
    assert.equal(result.length, items.length);
  });

  it("matches items by single label", () => {
    const result = filterByLabels(items, ["Work"]);
    assert.deepEqual(
      result.map((i) => i.id),
      ["a", "c"],
    );
  });

  it("uses OR semantics with multiple labels", () => {
    const result = filterByLabels(items, ["Work", "Personal"]);
    assert.deepEqual(
      result.map((i) => i.id),
      ["a", "b", "c"],
    );
  });

  it("is case-insensitive", () => {
    const lower = filterByLabels(items, ["work"]);
    const upper = filterByLabels(items, ["WORK"]);
    assert.deepEqual(
      lower.map((i) => i.id),
      upper.map((i) => i.id),
    );
    assert.deepEqual(
      lower.map((i) => i.id),
      ["a", "c"],
    );
  });

  it("excludes items without labels when filter is non-empty", () => {
    const result = filterByLabels(items, ["Work"]);
    assert.ok(!result.find((i) => i.id === "d"));
    assert.ok(!result.find((i) => i.id === "e"));
  });

  it("does not mutate the input array", () => {
    const original = items.slice();
    filterByLabels(items, ["Work"]);
    assert.deepEqual(items, original);
  });
});

describe("listLabelsWithCount", () => {
  it("returns empty for an empty collection", () => {
    assert.deepEqual(listLabelsWithCount([]), []);
  });

  it("returns empty when no item has labels", () => {
    const items = [{ id: "a" }, { id: "b", labels: [] }];
    assert.deepEqual(listLabelsWithCount(items), []);
  });

  it("counts labels across items", () => {
    const items = [{ labels: ["Work", "Urgent"] }, { labels: ["Work"] }, { labels: ["Personal"] }];
    const result = listLabelsWithCount(items);
    // Sorted by count desc, then label asc
    assert.deepEqual(result, [
      { label: "Work", count: 2 },
      { label: "Personal", count: 1 },
      { label: "Urgent", count: 1 },
    ]);
  });

  it("groups case-insensitively", () => {
    const items = [{ labels: ["Work"] }, { labels: ["work"] }, { labels: ["WORK"] }];
    const result = listLabelsWithCount(items);
    assert.equal(result.length, 1);
    assert.equal(result[0].count, 3);
    // Display form is the first-seen case
    assert.equal(result[0].label, "Work");
  });

  it("de-duplicates labels repeated within a single item", () => {
    // Shouldn't happen post-mergeLabels, but be defensive
    const items = [{ labels: ["Urgent", "urgent", "URGENT"] }];
    const result = listLabelsWithCount(items);
    assert.equal(result.length, 1);
    assert.equal(result[0].count, 1);
  });

  it("sorts alphabetically (case-insensitive) when counts are equal", () => {
    const items = [{ labels: ["Zebra"] }, { labels: ["apple"] }, { labels: ["Mango"] }];
    const result = listLabelsWithCount(items);
    assert.deepEqual(
      result.map((item) => item.label),
      ["apple", "Mango", "Zebra"],
    );
  });
});

describe("mergeLabels", () => {
  it("adds new labels to an empty existing set", () => {
    assert.deepEqual(mergeLabels([], ["Work", "Urgent"]), ["Work", "Urgent"]);
  });

  it("preserves existing labels when nothing is added", () => {
    assert.deepEqual(mergeLabels(["Work"], []), ["Work"]);
  });

  it("appends new labels without disturbing existing order", () => {
    assert.deepEqual(mergeLabels(["Work", "Personal"], ["Urgent"]), ["Work", "Personal", "Urgent"]);
  });

  it("de-duplicates case-insensitively", () => {
    assert.deepEqual(mergeLabels(["Work"], ["work", "WORK"]), ["Work"]);
  });

  it("keeps the existing case when a duplicate-in-other-case is added", () => {
    // "Work" stays, "work" doesn't replace it
    assert.deepEqual(mergeLabels(["Work"], ["work"]), ["Work"]);
  });

  it("normalises whitespace on both sides", () => {
    assert.deepEqual(mergeLabels(["  Work  "], [" Urgent "]), ["Work", "Urgent"]);
  });

  it("rejects empty additions silently", () => {
    assert.deepEqual(mergeLabels(["Work"], ["", "   "]), ["Work"]);
  });
});

describe("subtractLabels", () => {
  it("removes matching labels (case-insensitive)", () => {
    assert.deepEqual(subtractLabels(["Work", "Urgent", "Personal"], ["work"]), ["Urgent", "Personal"]);
  });

  it("is a no-op when removing a label that isn't there", () => {
    assert.deepEqual(subtractLabels(["Work"], ["Nonexistent"]), ["Work"]);
  });

  it("preserves the order of surviving labels", () => {
    assert.deepEqual(subtractLabels(["A", "B", "C", "D"], ["B", "D"]), ["A", "C"]);
  });

  it("returns existing set unchanged when removing empty list", () => {
    assert.deepEqual(subtractLabels(["Work", "Urgent"], []), ["Work", "Urgent"]);
  });

  it("normalises whitespace on existing entries even when not removing", () => {
    assert.deepEqual(subtractLabels(["  Work  ", "Urgent"], []), ["Work", "Urgent"]);
  });

  it("drops invalid entries from existing side", () => {
    assert.deepEqual(subtractLabels(["Work", "", "   ", "Urgent"], []), ["Work", "Urgent"]);
  });
});
